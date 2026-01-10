# Publishing @gofindme/client

This guide explains how to build and publish the @gofindme/client npm package.

## Prerequisites

1. Node.js and npm installed
2. npm account with access to the @gofindme organization (for private packages)
3. Authenticated with npm: `npm login`

## Building the Package

From the root directory:

```bash
# Build only the client package
npm run client:build

# Or build from the client directory
cd packages/client
npm run build
```

This compiles TypeScript to JavaScript and generates type definitions in the `dist/` directory.

## Publishing as Private Package

The package is configured by default to publish as **private** (restricted access).

1. Make sure you're logged into npm:
   ```bash
   npm login
   ```

2. Build the package:
   ```bash
   npm run client:build
   ```

3. Publish:
   ```bash
   npm run client:publish
   ```

   Or from the client directory:
   ```bash
   cd packages/client
   npm publish
   ```

## Publishing as Public Package

To publish as a public package:

1. Update `packages/client/package.json`:
   ```json
   {
     "publishConfig": {
       "access": "public"
     }
   }
   ```

2. Build and publish:
   ```bash
   npm run client:build
   npm run client:publish:public
   ```

   Or manually:
   ```bash
   cd packages/client
   npm publish --access public
   ```

## Versioning

Update the version in `packages/client/package.json` before publishing:

- **Patch version** (0.1.0 → 0.1.1): Bug fixes
- **Minor version** (0.1.0 → 0.2.0): New features, backward compatible
- **Major version** (0.1.0 → 1.0.0): Breaking changes

## Testing Before Publishing

1. Build the package:
   ```bash
   cd packages/client
   npm run build
   ```

2. Test locally using npm link:
   ```bash
   # In packages/client directory
   npm link

   # In your test project (e.g., location-test)
   cd ~/git/location-test
   npm link @gofindme/client
   ```

3. Or use a local file path in your test project's package.json:
   ```json
   {
     "dependencies": {
       "@gofindme/client": "file:../gofindme-server/packages/client"
     }
   }
   ```

## Package Contents

The published package includes:
- `dist/` - Compiled JavaScript and TypeScript definitions
- `README.md` - Package documentation
- `package.json` - Package metadata

Files excluded (via `.gitignore` and `.npmignore`):
- `src/` - Source TypeScript files
- `node_modules/` - Dependencies
- `tsconfig.json` - TypeScript configuration
- `*.log` - Log files

## Troubleshooting

### "403 Forbidden" when publishing
- Make sure you're logged into npm: `npm whoami`
- Check that you have publish permissions for the @gofindme scope
- For private packages, ensure you're part of the npm organization

### Type errors in published package
- Make sure `declaration: true` is set in `tsconfig.json`
- Verify that `dist/` contains `.d.ts` files
- Check that `package.json` has `"types": "./dist/index.d.ts"`

### Package too large
- Check that `.npmignore` excludes source files and node_modules
- Use `npm pack` to preview what will be published: `npm pack --dry-run`
