# Integration Tests

This directory contains integration tests that require manual interaction and real-world testing scenarios.

## Overview

The integration tests (`locations.integration.test.ts`) are designed to test:

1. **Phone App Integration**: Tests that wait for location data from a real phone app
2. **Developer App Integration**: Tests that verify developer apps receive location updates via SSE streams

## Running Integration Tests

### Prerequisites

- Server must be running (or tests will start their own instance)
- For phone app tests: A real phone app or way to send POST requests to `/api/v1/locations`
- For developer app tests: A developer app that can connect to SSE streams

### Run All Integration Tests

```bash
pnpm test locations.integration.test.ts
```

### Run Specific Test

```bash
pnpm test locations.integration.test.ts -t "should receive and validate location data from phone app"
```

## Test Scenarios

### 1. Phone App Integration Test

**What it does:**

- Waits for location data from a real phone app
- Validates the received payload
- Allows you to confirm if the data is correct

**How to use:**

1. Start the test
2. The test will display the server URL and endpoint details
3. Send a location update from your phone app (or manually via POST request)
4. The test will validate the received data
5. Confirm if the location data is correct when prompted

**Example manual request:**

```bash
curl -X POST http://localhost:3000/api/v1/locations \
  -H "Authorization: Bearer <your-auth0-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "recordedAt": "2024-01-01T00:00:00Z"
  }'
```

### 2. Developer App Integration Test (With Access)

**What it does:**

- Connects a developer app (SSE subscriber) with an API key
- Waits for you to confirm the app is ready
- Emulates a phone location update
- Verifies the developer app receives the location data

**How to use:**

1. Start the test
2. The test will connect an SSE subscriber with an API key
3. Verify your developer app is connected and ready
4. Press Enter to continue
5. The test will send a location update
6. Confirm if your developer app received the data

**What to check:**

- Your developer app should show a connection to the SSE stream
- After the location update is sent, your app should receive the location data
- Verify the location data matches what was sent

### 3. Developer App Integration Test (Without Access)

**What it does:**

- Connects a developer app with an API key for Group 2
- Sends a location update for a user in Group 1 (different group)
- Verifies the developer app does NOT receive the location data

**How to use:**

1. Start the test
2. The test will connect an SSE subscriber with an API key for Group 2
3. Verify your developer app is connected
4. Press Enter to continue
5. The test will send a location update for Group 1
6. Confirm that your developer app did NOT receive the data

**What to check:**

- Your developer app should be connected but should NOT receive location updates for Group 1
- This verifies that group isolation and authorization are working correctly

### 4. Multiple Location Updates Test

**What it does:**

- Sends multiple location updates in sequence
- Verifies all updates are received by the developer app

**How to use:**

1. Start the test
2. The test will connect and send 3 location updates
3. Confirm if your developer app received all updates

## Interactive Prompts

The tests use interactive prompts that you'll need to respond to:

- **Yes/No questions**: Type `y` or `yes` for yes, `n` or `no` for no
- **Press Enter**: Just press Enter to continue
- **Skip test**: Type `skip` to skip a test (for phone app test)

## Test Timeouts

Integration tests have longer timeouts to allow for manual interaction:

- Phone app test: 2 minutes
- Developer app tests: 5 minutes each

## Troubleshooting

### Test fails to connect to SSE stream

- Make sure the server is running
- Check that the server URL is correct
- Verify the API key is valid and not revoked

### Developer app doesn't receive location updates

- Check that the API key is for the correct group
- Verify the user sending the location is a member of the group
- Check that the group has an active API key
- Look at server logs for any errors

### Location data not received in phone app test

- Verify you're sending the request to the correct endpoint
- Check that the Auth0 token is valid
- Ensure the user is a member of at least one group with an active API key
- Check server logs for any errors

## Helper Functions

The tests use helper functions from `helpers/user-input-helper.ts`:

- `readUserInput()`: Read a line of input from the user
- `askYesNo()`: Ask a yes/no question
- `waitForEnter()`: Wait for user to press Enter
- `waitForConfirmation()`: Display a message and wait for confirmation

## Notes

- These tests are interactive and require manual input
- They are designed to test real-world integration scenarios
- They may take longer to complete than unit tests
- Some tests can be skipped by typing "skip" when prompted
