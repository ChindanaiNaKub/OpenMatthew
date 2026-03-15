# Matthew AI Platform - Exact OAuth Parameters

## Extracted Date
March 15, 2026

## Extraction Method
JavaScript console command executed on Microsoft SSO login page:
```javascript
JSON.stringify(Object.fromEntries(new URL(window.location.href).searchParams), null, 2)
```

## Complete OAuth 2.0 Parameters

### Base Authorization URL
```
https://login.microsoftonline.com/cf8f1fdf-de69-4c29-91da-a2dfd04aa751/oauth2/v2.0/authorize
```

### Tenant ID
```
cf8f1fdf-de69-4c29-91da-a2dfd04aa751
```
This identifies the CMU (Chiang Mai University) Azure AD tenant.

### OAuth Parameters (Query String)

```json
{
  "client_id": "5bead6e5-ae10-4b96-abca-5c887092a70c",
  "redirect_uri": "https://matthew.cmu.ac.th",
  "response_type": "code",
  "scope": "api://cmu/Api/Account.Read.Me.Basic:cmu offline_access openid profile"
}
```

## Parameter Details

### client_id
```
5bead6e5-ae10-4b96-abca-5c887092a70c
```
- **Description**: Azure AD Application (Client) ID registered for the Matthew AI Platform
- **Type**: UUID/GUID format
- **Purpose**: Identifies the Matthew application to Microsoft's authorization server

### redirect_uri
```
https://matthew.cmu.ac.th
```
- **Description**: OAuth callback URI where authorization codes are sent after user authentication
- **Note**: Simple root domain redirect (no path specified)
- **Security**: Must be pre-registered in Azure AD app configuration

### response_type
```
code
```
- **Description**: OAuth 2.0 flow type
- **Value**: `code` indicates Authorization Code Flow
- **Security**: Most secure OAuth flow, suitable for web applications with backend
- **Process**: Returns authorization code which must be exchanged for tokens on backend

### scope
```
api://cmu/Api/Account.Read.Me.Basic:cmu offline_access openid profile
```

**Breakdown of scopes:**

1. **`api://cmu/Api/Account.Read.Me.Basic:cmu`**
   - Custom CMU API scope
   - Format: `api://{audience}/{permission}:{resource}`
   - Grants: Basic account read access for the current user in CMU system
   - Type: Application-specific delegated permission

2. **`offline_access`**
   - Microsoft Graph standard scope
   - Purpose: Request refresh tokens for long-term access
   - Enables: Token renewal without re-authentication

3. **`openid`**
   - OpenID Connect scope
   - Required for: ID token issuance
   - Contains: User identity claims

4. **`profile`**
   - OpenID Connect scope
   - Grants access to: User profile information (name, picture, etc.)
   - Common claims: name, family_name, given_name, picture, etc.

## Full Authorization URL (Reconstructed)

```
https://login.microsoftonline.com/cf8f1fdf-de69-4c29-91da-a2dfd04aa751/oauth2/v2.0/authorize?client_id=5bead6e5-ae10-4b96-abca-5c887092a70c&redirect_uri=https://matthew.cmu.ac.th&response_type=code&scope=api://cmu/Api/Account.Read.Me.Basic:cmu%20offline_access%20openid%20profile
```

## OAuth 2.0 Flow Analysis

### Flow Type
**Authorization Code Flow** (OAuth 2.0 / OpenID Connect)

### Flow Steps
1. **User clicks "Login with a CMU account"** on matthew.cmu.ac.th
2. **Redirect to Microsoft authorization endpoint** with parameters above
3. **User authenticates** with CMU credentials via Microsoft SSO
4. **User grants consent** (if not previously granted)
5. **Redirect back to matthew.cmu.ac.th** with authorization code in URL
6. **Backend exchanges code for tokens** at token endpoint:
   ```
   POST https://login.microsoftonline.com/cf8f1fdf-de69-4c29-91da-a2dfd04aa751/oauth2/v2.0/token
   ```
7. **Backend receives**:
   - Access token (for API calls)
   - ID token (for user identity)
   - Refresh token (for token renewal, due to `offline_access` scope)

### Token Exchange Parameters
The backend would exchange the authorization code using:
```
POST /oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

client_id=5bead6e5-ae10-4b96-abca-5c887092a70c
&scope=api://cmu/Api/Account.Read.Me.Basic:cmu offline_access openid profile
&code={authorization_code}
&redirect_uri=https://matthew.cmu.ac.th
&grant_type=authorization_code
&client_secret={client_secret}
```

## Security Observations

### Strengths
1. ✅ **Authorization Code Flow**: Most secure OAuth 2.0 flow for web apps
2. ✅ **HTTPS enforced**: All communication over secure channel
3. ✅ **Tenant-specific endpoint**: Restricts authentication to CMU tenant only
4. ✅ **Minimal scope request**: Only requests necessary permissions
5. ✅ **Registered redirect URI**: Pre-configured in Azure AD for security
6. ✅ **Backend token exchange**: Tokens not exposed to browser

### Security Features
- **Client secret protection**: Secret only used on backend, never in browser
- **Short-lived authorization codes**: Code must be exchanged quickly
- **Refresh token support**: Allows seamless session extension
- **ID token verification**: Can verify user identity with OIDC

## API Integration Insights

### Custom CMU API
The scope `api://cmu/Api/Account.Read.Me.Basic:cmu` suggests:
- CMU has a custom API registered in Azure AD
- API identifier: `api://cmu`
- Permission: `Api/Account.Read.Me.Basic:cmu`
- Purpose: Read basic account information for the authenticated user

### Expected API Endpoints
Based on scope, likely backend API calls:
```
GET https://{cmu-api-domain}/api/account/me
Authorization: Bearer {access_token}
```

This would return the authenticated user's basic profile from CMU systems.

### Integration Pattern
```
Matthew Frontend (React)
    ↓ (OAuth redirect)
Microsoft Azure AD (CMU Tenant)
    ↓ (authorization code)
Matthew Backend
    ↓ (code → tokens exchange)
Microsoft Token Endpoint
    ↓ (access token)
CMU Custom API
    ↓ (user data)
Matthew Backend → Frontend
```

## Implementation Notes

### Backend Requirements
1. **Client Secret**: Securely stored in backend environment variables
2. **Token Storage**: Secure session storage for access/refresh tokens
3. **Token Refresh Logic**: Implement automatic token renewal using refresh tokens
4. **API Client**: HTTP client configured to call CMU API with access token

### Frontend Requirements
1. **Login Redirect**: Construct authorization URL with correct parameters
2. **Callback Handler**: Process authorization code from redirect
3. **Session Management**: Maintain authenticated session state
4. **Token Handling**: Never store or process tokens in frontend (backend only)

## Additional Parameters (May Exist in Implementation)

While not visible in this authorization request, these parameters are commonly used:

- **state**: CSRF protection token (recommended for security)
- **nonce**: Replay attack protection for ID tokens
- **prompt**: Control user interaction (e.g., `login`, `consent`, `none`)
- **login_hint**: Pre-fill user's email/username
- **domain_hint**: Specify account type (e.g., `organizations`)
- **response_mode**: How response is returned (e.g., `query`, `form_post`)

These may be added in the actual implementation for enhanced security and UX.

## Summary

The Matthew AI Platform uses a **secure, standard OAuth 2.0 Authorization Code Flow** with **OpenID Connect** for authentication. It integrates with CMU's Microsoft Azure AD tenant and requests access to a custom CMU API for basic user account information. The implementation follows security best practices with backend token handling and minimal scope requests.
