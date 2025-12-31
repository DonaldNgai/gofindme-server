# GoFindMe Server

A modern Fastify server built with TypeScript, featuring comprehensive linting, testing, and best practices.

## 🚀 Features

- ⚡ **Fastify** - Fast and low overhead web framework
- 📘 **TypeScript** - Type-safe development
- 🎨 **ESLint + Prettier** - Code quality and formatting
- 🧪 **Vitest** - Fast unit testing
- 🔒 **Security** - Helmet for security headers
- 📚 **Swagger/OpenAPI** - Auto-generated API documentation
- 🪝 **Husky + lint-staged** - Pre-commit hooks
- 📦 **pnpm** - Fast, disk space efficient package manager

## 📋 Prerequisites

- Node.js >= 18
- pnpm >= 8

## 🛠️ Installation

```bash
# Install dependencies
pnpm install
```

## 🏃 Development

```bash
# Start development server with hot reload
pnpm dev

# Run in production mode
pnpm build
pnpm start
```

## 🧪 Testing

```bash
# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests with UI
pnpm test:ui
```

### Testing with Auth0 Tokens

For tests that require Auth0 authentication, provide real Auth0 tokens via environment variables:

```env
# Optional: Test Auth0 tokens for authenticated test scenarios
TEST_AUTH0_TOKEN_USER_1=your-auth0-token-here
TEST_AUTH0_TOKEN_USER_2=another-auth0-token-here
```

These tokens should be real tokens from your Auth0 tenant. To get a token:
1. Use your Auth0 dashboard to create a test token
2. Or use the Auth0 Management API to generate tokens
3. Or use Auth0's test token endpoint

The test helper (`src/routes/public/tests/helpers/auth-helper.ts`) provides utilities to retrieve these tokens in tests.

## 🔍 Code Quality

```bash
# Lint code
pnpm lint

# Fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Check formatting
pnpm format:check

# Type check
pnpm type-check
```

## 📁 Project Structure

```
gofindme-server/
├── src/
│   ├── config/          # Configuration files
│   │   └── env.ts       # Environment validation
│   ├── plugins/         # Fastify plugins
│   │   ├── cors.ts
│   │   ├── helmet.ts
│   │   └── swagger.ts
│   ├── routes/          # API routes
│   │   ├── health.ts
│   │   └── health.test.ts
│   ├── app.ts           # App builder
│   └── server.ts        # Server entry point
├── dist/                # Compiled output
├── .env.example         # Environment variables template
├── tsconfig.json        # TypeScript configuration
├── vitest.config.ts     # Vitest configuration
└── package.json
```

## 🌐 API Documentation

Once the server is running, visit:
- Swagger UI: http://localhost:3000/docs
- Health Check: http://localhost:3000/api/v1/health

## 🔐 Environment Variables

Copy `.env.example` to `.env` and configure:

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
API_PREFIX=/api/v1
CORS_ORIGIN=http://localhost:3000
```

## 📝 Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm test` - Run tests
- `pnpm lint` - Lint code
- `pnpm format` - Format code
- `pnpm type-check` - Type check without emitting

## 🎯 Best Practices

- All routes are prefixed with `/api/v1`
- Environment variables are validated with Zod
- Type-safe throughout the application
- Pre-commit hooks ensure code quality
- Comprehensive error handling
- Security headers with Helmet
- CORS configured for cross-origin requests

## 📄 License

ISC

