import hashlib
import json
import math
import shutil
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from pyspark.sql import functions as F
from pyspark.sql.types import DoubleType, StringType, StructField, StructType

context = notebookutils.runtime.context
if context["defaultLakehouseId"] != lakehouse_id:
    raise RuntimeError("The notebook is not attached to the expected Translink lakehouse.")

source_url = "https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip"
staging = Path("/lakehouse/default/Files/translink_gtfs")
staging.mkdir(parents=True, exist_ok=True)
archive_path = staging / "SEQ_GTFS.zip"
with urllib.request.urlopen(source_url, timeout=180) as response:
    with archive_path.open("wb") as target:
        shutil.copyfileobj(response, target)
digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
required = ["routes.txt", "trips.txt", "stops.txt", "stop_times.txt", "calendar.txt", "calendar_dates.txt"]
with zipfile.ZipFile(archive_path) as archive:
    for filename in required:
        if filename not in archive.namelist():
            raise RuntimeError(f"Missing GTFS file: {filename}")
        with archive.open(filename) as source, (staging / filename).open("wb") as target:
            shutil.copyfileobj(source, target)


def read_gtfs(filename):
    return spark.read.option("header", True).option("mode", "FAILFAST").csv(
        f"Files/translink_gtfs/{filename}.txt"
    )


def assert_key(frame, key, name):
    if frame.where(F.col(key).isNull() | (F.col(key) == "")).limit(1).count():
        raise RuntimeError(f"{name}.{key} contains an empty key")
    if frame.groupBy(key).count().where("count > 1").limit(1).count():
        raise RuntimeError(f"{name}.{key} contains duplicate keys")


def assert_fk(child, column, parent, key, name):
    if child.join(parent.select(F.col(key).alias(column)), column, "left_anti").limit(1).count():
        raise RuntimeError(f"Broken relationship: {name}")


routes = read_gtfs("routes").where(F.col("route_id").isin(selected_route_ids)).select(
    "route_id", "route_short_name", "route_long_name",
    F.col("route_type").cast("long").alias("route_type"),
    F.when(F.col("route_type").isin("1", "2"), "rail").otherwise("bus").alias("mode"),
)
if routes.count() != len(selected_route_ids):
    raise RuntimeError("The current GTFS route IDs differ from the map snapshot. Refresh the map and regenerate the notebook.")
trips = read_gtfs("trips").join(routes.select("route_id"), "route_id", "inner").select(
    "trip_id", "route_id", "service_id", "trip_headsign", "shape_id",
    F.col("direction_id").cast("long").alias("direction_id"),
).cache()
raw_calls = read_gtfs("stop_times").join(trips.select("trip_id"), "trip_id", "inner")


def seconds(column):
    parts = F.split(F.col(column), ":")
    return F.when(
        F.col(column).rlike(r"^\d+:[0-5]\d:[0-5]\d$"),
        parts[0].cast("long") * 3600 + parts[1].cast("long") * 60 + parts[2].cast("long"),
    )


stop_calls = raw_calls.select(
    F.concat_ws(":", "trip_id", "stop_sequence").alias("stop_call_id"),
    "trip_id", "stop_id", F.col("stop_sequence").cast("long").alias("stop_sequence"),
    "arrival_time", "departure_time",
    seconds("arrival_time").alias("arrival_seconds"),
    seconds("departure_time").alias("departure_seconds"),
).cache()
all_stops = read_gtfs("stops")
served_stops = all_stops.join(stop_calls.select("stop_id").distinct(), "stop_id", "inner")
parent_ids = served_stops.select(F.col("parent_station").alias("stop_id")).where("stop_id IS NOT NULL")
stop_ids = served_stops.select("stop_id").union(parent_ids).distinct()
stops = all_stops.join(stop_ids, "stop_id", "inner").select(
    "stop_id", "stop_name", "parent_station",
    F.col("stop_lat").cast("double").alias("latitude"),
    F.col("stop_lon").cast("double").alias("longitude"),
    F.coalesce(F.col("location_type"), F.lit("0")).cast("long").alias("location_type"),
).cache()
service_ids = trips.select("service_id").distinct()
calendar = read_gtfs("calendar")
exceptions = read_gtfs("calendar_dates").join(service_ids, "service_id", "inner").select(
    F.concat_ws(":", "service_id", "date").alias("exception_id"),
    "service_id", F.col("date").alias("service_date"),
    F.col("exception_type").cast("long").alias("exception_type"),
)
exception_bounds = exceptions.groupBy("service_id").agg(
    F.min("service_date").alias("exception_start"), F.max("service_date").alias("exception_end")
)
days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
services = service_ids.join(calendar, "service_id", "left").join(exception_bounds, "service_id", "left").select(
    "service_id",
    *[F.coalesce(F.col(day), F.lit("0")).cast("long").alias(day) for day in days],
    F.coalesce("start_date", "exception_start").alias("start_date"),
    F.coalesce("end_date", "exception_end").alias("end_date"),
)
venues = spark.createDataFrame(
    [("suncorp-stadium", "Suncorp Stadium", -27.4648, 153.0095, "Demo venue reference point; approximate coordinates")],
    StructType([
        StructField("venue_id", StringType(), False), StructField("venue_name", StringType(), False),
        StructField("latitude", DoubleType(), False), StructField("longitude", DoubleType(), False),
        StructField("coordinate_source", StringType(), False),
    ]),
)
latitude = F.radians(F.col("latitude"))
delta_lat = latitude - math.radians(-27.4648)
delta_lon = F.radians(F.col("longitude")) - math.radians(153.0095)
a = F.pow(F.sin(delta_lat / 2), 2) + F.cos(latitude) * math.cos(math.radians(-27.4648)) * F.pow(F.sin(delta_lon / 2), 2)
nearby = stops.withColumn("distance_metres", 6371000 * 2 * F.asin(F.sqrt(a))).where("distance_metres <= 1200")
venue_stop_links = nearby.select(
    F.concat(F.lit("suncorp-stadium:"), F.col("stop_id")).alias("link_id"),
    F.lit("suncorp-stadium").alias("venue_id"), "stop_id",
    F.round("distance_metres", 1).alias("distance_metres"),
    F.lit("Approximate straight-line distance; not walking distance or evidence of event service").alias("distance_method"),
)
frames = {
    "routes": (routes, "route_id"), "trips": (trips, "trip_id"), "stops": (stops, "stop_id"),
    "stop_calls": (stop_calls, "stop_call_id"), "services": (services, "service_id"),
    "service_exceptions": (exceptions, "exception_id"), "venues": (venues, "venue_id"),
    "venue_stop_links": (venue_stop_links, "link_id"),
}
for name, (frame, key) in frames.items():
    assert_key(frame, key, name)
assert_fk(trips, "route_id", routes, "route_id", "Trip to Route")
assert_fk(trips, "service_id", services, "service_id", "Trip to Service")
assert_fk(stop_calls, "trip_id", trips, "trip_id", "StopCall to Trip")
assert_fk(stop_calls, "stop_id", stops, "stop_id", "StopCall to Stop")
assert_fk(venue_stop_links, "stop_id", stops, "stop_id", "VenueStopLink to Stop")
counts = {}
schemas = {}
for name, (frame, _) in frames.items():
    frame.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"dbo.{name}")
    counts[name] = spark.table(f"dbo.{name}").count()
    schemas[name] = [{"name": field.name, "type": field.dataType.simpleString()} for field in frame.schema.fields]
    print(f"Verified managed table dbo.{name}: {counts[name]} rows")
manifest = {
    "source_url": source_url, "imported_at": datetime.now(timezone.utc).isoformat(),
    "sha256": digest, "counts": counts, "schemas": schemas,
    "scope": "Selected Brisbane map routes, their GTFS trips, all served stops and parent stations. Calendar exceptions must override weekly service calendars.",
    "licence": "CC BY 4.0; Translink / Queensland Department of Transport and Main Roads",
}
spark.createDataFrame([(json.dumps(manifest),)], ["manifest_json"]).write.format("delta").mode("overwrite").saveAsTable("dbo.feed_manifest")
with (staging / "validation.json").open("w", encoding="utf-8") as target:
    json.dump(manifest, target)
trips.unpersist()
stop_calls.unpersist()
stops.unpersist()
notebookutils.notebook.exit(json.dumps(manifest))
