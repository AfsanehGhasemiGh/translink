targetScope = 'subscription'

@minLength(1)
@maxLength(64)
param environmentName string

@minLength(1)
param location string

param sessionId string
param deployedBy string
param createdAt string

@minLength(1)
param entraTenantId string

@minLength(1)
param entraClientId string

@minLength(1)
param fabricTokenAudience string

var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: environmentName
  'deployed-by': deployedBy
}

// Existing approved scope: do not create, retag, resize, or otherwise modify it.
resource existingResourceGroup 'Microsoft.Resources/resourceGroups@2023-07-01' existing = {
  name: 'rsc'
}

module app './modules/app-service.bicep' = {
  name: 'app-translink-dev-44c6'
  scope: existingResourceGroup
  params: {
    location: location
    tags: tags
    appServicePlanName: 'asp-cwydrbyit'
    appServiceName: 'app-translink-dev-44c6'
    entraTenantId: entraTenantId
    entraClientId: entraClientId
    fabricTokenAudience: fabricTokenAudience
  }
}

output appServiceId string = app.outputs.appServiceId
output defaultHostName string = app.outputs.defaultHostName
