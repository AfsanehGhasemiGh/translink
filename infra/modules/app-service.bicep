param location string
param tags object
param appServicePlanName string
param appServiceName string

@minLength(1)
param entraTenantId string

@minLength(1)
param entraClientId string

@minLength(1)
param fabricTokenAudience string

resource appServicePlan 'Microsoft.Web/serverfarms@2022-03-01' existing = {
  name: appServicePlanName
}

resource appService 'Microsoft.Web/sites@2026-08-01' = {
  name: appServiceName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/health'
    }
  }
}

// SCM basic auth remains available only for the approved ZIP deployment step.
// The deployment phase must re-disable it immediately after upload.
resource scmAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2026-08-01' = {
  parent: appService
  name: 'scm'
  properties: {
    allow: true
  }
}

resource ftpAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2026-08-01' = {
  parent: appService
  name: 'ftp'
  properties: {
    allow: false
  }
}

resource appSettings 'Microsoft.Web/sites/config@2026-08-01' = {
  parent: appService
  name: 'appsettings'
  properties: {
    HOSTED_MODE: 'true'
    // Use the hostname returned by App Service rather than deriving a legacy hostname.
    PUBLIC_ORIGIN: 'https://${appService.properties.defaultHostName}'
    ENTRA_TENANT_ID: entraTenantId
    ENTRA_CLIENT_ID: entraClientId
    FABRIC_TOKEN_AUDIENCE: fabricTokenAudience
    PORT: '8080'
    NODE_ENV: 'production'
    WEBSITE_NODE_DEFAULT_VERSION: '~22'
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'true'
    ENABLE_ORYX_BUILD: 'true'
    ORYX_DISABLE_COMPRESSION: 'true'
    NPM_CONFIG_INCLUDE: 'dev'
  }
}

output appServiceId string = appService.id
output defaultHostName string = appService.properties.defaultHostName
output principalId string = appService.identity.principalId
