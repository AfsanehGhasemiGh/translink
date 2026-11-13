export function parsePlannerResponse(output, operation) {
  const value = typeof output === 'string' ? JSON.parse(output) : output;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The planner returned an invalid response.');
  }

  if (operation === 'status' && (value.connected !== true || !Number.isInteger(value.entityCount))) {
    throw new Error('The planner did not confirm a valid Fabric connection.');
  }
  if (operation === 'ask' && (typeof value.answer !== 'string' || !value.answer.trim())) {
    throw new Error('The planner returned no answer.');
  }
  if (operation === 'ontology' && (!Array.isArray(value.entities) || !Array.isArray(value.bindings))) {
    throw new Error('The planner returned no valid ontology bindings.');
  }
  return value;
}

export function splitPlannerAnswer(markdown) {
  const lines = markdown.split('\n');
  let fence;
  for (let index = 0; index < lines.length; index++) {
    const marker = lines[index].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
    }
    if (!fence && /^##\s+Evidence\s*$/i.test(lines[index])) {
      return { answer: lines.slice(0, index).join('\n'), evidence: lines.slice(index).join('\n') };
    }
  }
  return { answer: markdown, evidence: '' };
}
