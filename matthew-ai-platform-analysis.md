# Matthew AI Platform - Login Flow and API Analysis

## Overview
Analysis of the Matthew CMU AI Platform (https://matthew.cmu.ac.th/) login flow and observable API endpoints.

## Date
March 15, 2026

## Landing Page

### URL
`https://matthew.cmu.ac.th/`

### Interface
- Clean landing page with Matthew AI Platform branding
- Features logos for TLIC (Teaching and Learning Innovation Center) and CMU (Chiang Mai University)
- Single primary action: "Login with a CMU account" button
- Minimal, focused design for authentication entry point

## Login Flow

### Authentication Method
**Microsoft OAuth/OIDC (Single Sign-On)**

### Flow Process
1. User clicks "Login with a CMU account" on matthew.cmu.ac.th
2. Application redirects to Microsoft's authorization endpoint
3. User would authenticate via Microsoft IT Account (CMU credentials)
4. After successful authentication, redirects back to matthew.cmu.ac.th with authorization code

### Authorization Endpoint
**URL Pattern:**
```
https://login.microsoftonline.com/cf8f1fdf-de69-4c29-91da-a2dfd04aa751/oauth2/v2.0/authorize
```

**Key Parameters Observed:**
- `client_id`: 5bead6e5-ae10-4b96-abca-5c887092a70c
- `redirect_uri`: https://matthew.cmu.ac.th/response_type=code&scope=...
- `response_type`: code
- Utilizes standard OAuth 2.0 Authorization Code flow

## API Endpoints and Domains

### Primary Application Domain
- `matthew.cmu.ac.th` - Main application domain

### Authentication Related Domains
- `login.microsoftonline.com` - Microsoft OAuth/OIDC provider
- `aadcdn.msftauth.net` - Microsoft authentication CDN
- `aadcdn.msauthimages.net` - Microsoft authentication images/assets

### Content Delivery
- Content served with gzip compression
- Security headers include CSP (Content Security Policy)
- No-referrer policy for enhanced privacy

## Network Requests Observed

### Initial Page Load
1. Main HTML document (matthew.cmu.ac.th)
2. Static assets (CSS, JS, images)
3. CMU logo image (logo192.png)

### Login Button Click
1. Redirect to Microsoft authorization endpoint
2. Multiple Microsoft infrastructure requests:
   - Authorization client scripts
   - Login page resources
   - Convergence login UI components
   - Authentication polyfills and vendor libraries

### Request Characteristics
- Modern web application with dynamic JavaScript components
- HTTPS enforced throughout
- Standard OAuth 2.0 security patterns
- Cross-origin protections in place

## Security Observations

### Authentication Security
- Uses industry-standard OAuth 2.0 / OpenID Connect
- Delegates authentication to Microsoft's SSO infrastructure
- No credentials directly handled by Matthew platform
- Secure redirect flow with state parameters

### Headers
- `Cache-Control`: no-store, no-cache
- `Content-Security-Policy`: Restrictive CSP with nonce-based script execution
- Referrer-Policy: no-referrer-when-downgrade

## Technical Stack Indicators

### Frontend
- React-based application (based on typical asset structure)
- Modern JavaScript (ES6+)
- Bootstrap/responsive CSS framework evident

### Authentication
- OAuth 2.0 / OpenID Connect
- Microsoft Azure AD integration
- Token-based authentication pattern (code grant flow)

## API Endpoint Patterns

Based on the redirect URI structure, the expected API endpoints would follow:
- Base: `https://matthew.cmu.ac.th/`
- OAuth callback: `https://matthew.cmu.ac.th/` (with query parameters for authorization code)

### Likely Backend API Structure
While not directly observable without authentication, typical patterns suggest:
- `/api/auth/*` - Authentication endpoints
- `/api/chat/*` or `/api/conversations/*` - Chat/AI interaction endpoints
- `/api/user/*` - User profile and settings

## Key Findings

1. **SSO Integration**: Matthew AI Platform uses CMU's Microsoft-based SSO, ensuring centralized credential management
2. **No Custom Login**: No username/password fields on the platform itself - full delegation to Microsoft
3. **Standard OAuth Flow**: Implements industry-standard OAuth 2.0 authorization code flow
4. **Secure by Default**: Modern security headers and practices observed
5. **Clean Architecture**: Separation of authentication provider from application logic

## Limitations of Analysis

This analysis was conducted without authentication, so:
- Post-authentication API endpoints are not visible
- Internal API structure requires authenticated session to observe
- AI model endpoints and chat APIs would only be visible after successful login
- User-specific features and endpoints are not accessible

## Recommendations for Further Analysis

To fully understand the API structure, authenticated analysis would reveal:
1. Chat/conversation API endpoints
2. AI model interaction patterns
3. User management APIs
4. Document/file upload endpoints (if any)
5. Real-time communication protocols (WebSocket/SSE for streaming responses)

## Screenshots Reference

Multiple screenshots were captured showing:
1. Matthew AI Platform landing page
2. Microsoft SSO login interface
3. Chrome DevTools Network tab with authentication requests
4. Detailed authorization request headers and parameters
5. API domain patterns and request/response structures
