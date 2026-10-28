# 🌍 Wanderlust API — Backend

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Better_Auth-6366F1?style=for-the-badge" alt="Better Auth" />
  <img src="https://img.shields.io/badge/Deployed_on-Vercel-black?style=for-the-badge&logo=vercel" alt="Vercel" />
</p>

<p align="center">
  A secure REST API powering Wanderlust, a full-stack travel booking platform. Built with Express and MongoDB, featuring authentication, JWT verification, admin authorization, and protected booking operations.
</p>

<p align="center">
  <a href="https://wanderlust-server-sand.vercel.app/"><strong>🚀 Live API</strong></a>
  &nbsp; • &nbsp;
  <a href="https://wanderlust-omega-nine.vercel.app/"><strong>🌐 Live Website</strong></a>
  &nbsp; • &nbsp;
  <a href="#-api-documentation"><strong>📚 API Endpoints</strong></a>
</p>

---

## 📡 Live Demo

| Resource | Link |
|---|---|
| 🌐 Frontend Application | [Wanderlust Website](https://wanderlust-omega-nine.vercel.app/) |
| 🚀 Backend REST API | [Wanderlust API](https://wanderlust-server-sand.vercel.app/) |
| ❤️ API Health Check | [Check API Status](https://wanderlust-server-sand.vercel.app/) |
| 🧭 Destinations Endpoint | [Explore Destinations](https://wanderlust-server-sand.vercel.app/destinations) |

> The links point to the deployed application. Endpoint availability depends on the backend deployment and database configuration.

## ✨ Features

- 🚀 **RESTful API** — Express-powered endpoints for destinations, users, and bookings.
- 🍃 **MongoDB Integration** — Persistent data storage using the MongoDB Node.js driver.
- 🔐 **Authentication** — Better Auth session-cookie verification for supported requests.
- 🔑 **JWT Verification** — Verify JWT signatures using Better Auth's remote JWKS endpoint.
- 🛡️ **Admin Authorization** — Restrict administrative operations using a configured admin email.
- 🎟️ **Booking Management** — Create, retrieve, update, and delete bookings according to authorization rules.
- 👤 **Profile Management** — Retrieve and update the authenticated user's profile.
- 🧰 **Security Headers** — HTTP security headers using Helmet.
- 🌐 **CORS Configuration** — Control which frontend origin can access the API.
- 🚦 **Rate Limiting** — Limit excessive API requests.
- ✅ **ObjectId Validation** — Validate MongoDB document identifiers.
- ☁️ **Vercel Deployment** — Serverless deployment configuration.

## 🧰 Tech Stack

| Category | Technologies |
|---|---|
| Runtime | Node.js |
| Framework | Express 5 |
| Language | JavaScript (ES modules) |
| Database | MongoDB |
| Authentication | Better Auth-compatible session and JWT verification |
| JWT Verification | `jose` |
| Security | Helmet, CORS, express-rate-limit |
| Environment Configuration | dotenv |
| Deployment | Vercel |

## 🏗️ Application Architecture

Wanderlust uses a separate frontend and backend architecture. The Next.js frontend communicates with the Express API, which validates authentication and authorization before accessing protected resources.

```text
┌──────────────────────────────────┐
│          Next.js Frontend        │
│       React + TypeScript         │
│                                  │
│  Website / User / Admin UI       │
└────────────────┬─────────────────┘
                 │
                 │ HTTP Requests
                 │ Bearer JWT / Session Cookie
                 ▼
┌──────────────────────────────────┐
│          Express REST API        │
│                                  │
│  Authentication Middleware       │
│  JWT Signature Verification      │
│  Admin Authorization             │
│  Request Validation              │
│  Security Headers + Rate Limits  │
└────────────────┬─────────────────┘
                 │
                 ▼
┌──────────────────────────────────┐
│             MongoDB              │
│                                  │
│  Destinations                    │
│  Users                           │
│  Bookings                        │
└──────────────────────────────────┘
```

## 📂 Project Structure

```text
wanderlust-server/
├── index.js
├── package.json
├── package-lock.json
├── vercel.json
└── .gitignore
```

| File | Description |
|---|---|
| `index.js` | Express application, middleware, authentication, authorization, and API routes |
| `package.json` | Project dependencies and npm scripts |
| `package-lock.json` | Locked dependency versions |
| `vercel.json` | Vercel deployment configuration |
| `.gitignore` | Excludes environment variables and other unwanted files |

## 📚 API Documentation

**Production base URL:**

```text
https://wanderlust-server-sand.vercel.app
```

**Local development URL:**

```text
http://localhost:5000
```

### Available Endpoints

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/` | Public | API health check |
| `GET` | `/destinations` | Public | Retrieve all destinations |
| `GET` | `/destinations/:id` | Public | Retrieve a destination by MongoDB ObjectId |
| `GET` | `/users/me` | Authenticated | Retrieve the current user's profile |
| `PATCH` | `/users/me` | Authenticated | Update the current user's profile |
| `GET` | `/bookings` | Authenticated | Retrieve the user's bookings |
| `POST` | `/bookings` | Authenticated | Create a booking |
| `PATCH` | `/bookings/:id` | Authenticated | Update a booking according to authorization rules |
| `DELETE` | `/bookings/:id` | Authenticated | Delete a booking according to ownership/admin rules |

> Access requirements describe the intended API behavior. Confirm the actual middleware and route definitions in `index.js` before treating this table as an exhaustive access-control specification.

### Authentication

Protected endpoints use the authentication mechanism configured for the request and route.

For JWT-protected requests, send a valid Better Auth JWT using the Bearer authorization scheme.

```http
Authorization: Bearer <BETTER_AUTH_JWT>
Accept: application/json
```

The frontend obtains a token through Better Auth and sends it with protected API requests. The backend verifies the JWT signature using the configured JWKS endpoint and validates the expected issuer and audience.

Session-cookie authentication must also be configured correctly for any routes that accept session cookies.

### Admin Authorization

Administrative operations use the configured `ADMIN_EMAIL` value to identify the authorized administrator.

```env
ADMIN_EMAIL=admin@example.com
```

Replace the example email with the intended administrator's email address.

**Important:** Frontend-only admin checks are not sufficient. The backend must enforce administrator permissions for every protected administrative operation.

## 🗄️ Database

**Database:** `wanderlust`

| Collection | Purpose |
|---|---|
| `destinations` | Destination details, travel information, and pricing |
| `users` | User records |
| `bookings` | Booking information and associated user data |

The application also configures booking indexes for user/date sorting and user/destination lookups.

## 🚀 Getting Started

### Prerequisites

Before running the backend locally, make sure you have:

- Node.js (LTS recommended)
- npm
- A MongoDB database
- A configured Better Auth instance
- The frontend origin URL

### 1. Clone the Repository

```bash
git clone <YOUR_BACKEND_REPOSITORY_URL>
cd <YOUR_BACKEND_PROJECT_FOLDER>
```

Replace the placeholders with your actual repository URL and folder name.

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the backend project root.

```env
PORT=5000

MONGODB_URI=your_mongodb_connection_string

BETTER_AUTH_URL=http://localhost:3000

FRONTEND_URL=http://localhost:3000

ADMIN_EMAIL=admin@example.com
```

**Environment variable guide:**

| Variable | Purpose |
|---|---|
| `PORT` | Local API server port |
| `MONGODB_URI` | MongoDB connection string |
| `BETTER_AUTH_URL` | Base URL of the Better Auth server |
| `FRONTEND_URL` | Allowed frontend origin for CORS |
| `ADMIN_EMAIL` | Authorized administrator email |

Configuration requirements:

- Replace all example values with your own.
- Use a valid MongoDB connection string.
- Ensure `BETTER_AUTH_URL` matches the authentication server's configured URL.
- Configure `FRONTEND_URL` to match the frontend origin exactly.
- Keep `.env` out of version control.
- Use the appropriate production URLs when deploying.

### 4. Start the Development Server

```bash
npm run dev
```

The development script should use the project's configured automatic-restart tool, if applicable.

### 5. Start the Server

```bash
npm start
```

The default local server address is:

[http://localhost:5000](http://localhost:5000)

### 6. Test the API

Open the health-check endpoint:

[http://localhost:5000/](http://localhost:5000/)

Expected successful response:

```json
{
  "success": true,
  "message": "Wanderlust API is running"
}
```

The actual response depends on the implementation in `index.js`.

## ☁️ Deployment — Vercel

The backend is deployed at:

**https://wanderlust-server-sand.vercel.app/**

To configure a deployment:

1. Import the backend repository into Vercel.
2. Configure the required environment variables.
3. Set `MONGODB_URI` to the production MongoDB connection string.
4. Set `BETTER_AUTH_URL` to the deployed Better Auth base URL.
5. Set `FRONTEND_URL` to the deployed frontend origin.
6. Set `ADMIN_EMAIL` to the intended administrator's email.
7. Deploy the backend.
8. Test the health-check and destinations endpoints.
9. Set the frontend's `NEXT_PUBLIC_API_URL` to the deployed backend base URL.

The repository includes `vercel.json` to configure deployment routing to `index.js`.

> A successful deployment does not automatically guarantee that MongoDB connectivity, authentication, or protected API requests are working. Test the full application after deployment.

## 🔐 Security Best Practices

- 🔒 Keep database credentials and configuration secrets private.
- 🔑 Verify JWT signatures and relevant claims on the backend.
- 🛡️ Enforce admin authorization on server-side routes.
- 🌐 Restrict CORS to trusted frontend origins.
- 🚦 Apply rate limiting to help mitigate excessive requests.
- 🔐 Use HTTPS in production.
- 🍃 Use strong MongoDB credentials and least-privilege database access.
- 🧹 Avoid logging raw JWTs, passwords, or authentication secrets.
- 📁 Never commit `.env` files to GitHub.

## 🧪 Troubleshooting

| Problem | Possible solution |
|---|---|
| Server fails to start | Verify required environment variables and MongoDB connectivity |
| `401 Unauthorized` | Check the token, session, issuer, audience, and JWKS configuration |
| `403 Forbidden` | Verify the authenticated user's permissions and admin configuration |
| CORS errors | Check `FRONTEND_URL`, protocol, hostname, and port |
| MongoDB connection errors | Verify the connection string, credentials, and network access rules |
| Frontend cannot reach backend | Verify `NEXT_PUBLIC_API_URL` and test the deployed API |
| Destination endpoint fails | Check database connectivity and destination route implementation |

## 👨‍💻 Author

**Fahim Muntasir Rahat**

- GitHub: [@fahimrahat58](https://github.com/fahimrahat58)

## 📄 License

No license has been specified yet. Add a `LICENSE` file if you intend to distribute this project under an open-source license.
