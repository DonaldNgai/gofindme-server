/**
 * Browser-based input helper for integration tests
 *
 * This helper opens a browser window where users can type input,
 * which works much better than trying to read from stdin in Vitest.
 *
 * Usage:
 *   await waitForKeyboard(async () => {
 *     const input = await readUserInputFromBrowser({ prompt: 'Enter value:' });
 *     return input;
 *   });
 */

import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Cross-platform browser opening
async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    // Linux and others
    command = `xdg-open "${url}"`;
  }

  try {
    await execAsync(command);
  } catch {
    console.warn(`Failed to open browser automatically. Please open: ${url}`);
  }
}

type BrowserInputOptions = {
  prompt?: string;
  title?: string;
  placeholder?: string;
  timeout?: number;
  defaultAnswer?: string;
};

let inputServer: ReturnType<typeof createServer> | null = null;
let inputPort = 3003;
const pendingInputs = new Map<
  string,
  { resolve: (value: string) => void; reject: (error: Error) => void }
>();

/**
 * Read user input from a browser window
 *
 * @param options - Options for the input
 * @returns Promise that resolves to the user's input
 */
export async function readUserInputFromBrowser(options: BrowserInputOptions = {}): Promise<string> {
  const {
    prompt = 'Enter value:',
    title = 'Test Input',
    placeholder = 'Type here...',
    timeout = 0,
    defaultAnswer = '',
  } = options;

  // Start server if not already running
  if (!inputServer) {
    await startInputServer();
  }

  const inputId = `input-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const url = `http://localhost:${inputPort}?id=${inputId}&prompt=${encodeURIComponent(prompt)}&title=${encodeURIComponent(title)}&placeholder=${encodeURIComponent(placeholder)}`;

  // Open browser
  await openBrowser(url);

  // Wait for input
  return new Promise((resolve, reject) => {
    pendingInputs.set(inputId, { resolve, reject });

    if (timeout > 0) {
      setTimeout(() => {
        if (pendingInputs.has(inputId)) {
          pendingInputs.delete(inputId);
          resolve(defaultAnswer || '');
        }
      }, timeout);
    }
  });
}

/**
 * Wait for keyboard input (similar to @testing-library/react pattern)
 *
 * @param callback - Function that returns a promise with the input
 * @returns Promise that resolves when input is received
 */
export async function waitForKeyboard<T>(callback: () => Promise<T>): Promise<T> {
  return await callback();
}

/**
 * Ask yes/no question in browser
 */
export async function askYesNoInBrowser(
  question: string,
  options: Omit<BrowserInputOptions, 'prompt' | 'title'> = {}
): Promise<boolean> {
  const answer = await readUserInputFromBrowser({
    prompt: `${question} (y/n)`,
    title: 'Yes/No Question',
    placeholder: 'y or n',
    ...options,
  });
  return answer.toLowerCase().startsWith('y');
}

/**
 * Wait for user to press Enter/Submit in browser
 */
export async function waitForEnterInBrowser(
  message = 'Press Submit to continue...'
): Promise<void> {
  await readUserInputFromBrowser({
    prompt: message,
    title: 'Continue',
    placeholder: 'Press Submit when ready',
  });
}

function startInputServer(): Promise<void> {
  return new Promise((resolve) => {
    inputServer = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${inputPort}`);

      if (req.method === 'GET' && url.pathname === '/') {
        // Serve HTML input form
        const inputId = url.searchParams.get('id') || 'default';
        const prompt = url.searchParams.get('prompt') || 'Enter value:';
        const title = url.searchParams.get('title') || 'Test Input';
        const placeholder = url.searchParams.get('placeholder') || 'Type here...';

        const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 90%;
    }
    h1 {
      margin: 0 0 1rem 0;
      color: #333;
      font-size: 1.5rem;
    }
    label {
      display: block;
      margin-bottom: 0.5rem;
      color: #666;
      font-weight: 500;
    }
    input {
      width: 100%;
      padding: 0.75rem;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 1rem;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      margin-top: 1rem;
      width: 100%;
      padding: 0.75rem;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #5568d3;
    }
    button:active {
      background: #4457c2;
    }
    .status {
      margin-top: 1rem;
      padding: 0.5rem;
      border-radius: 4px;
      font-size: 0.9rem;
      text-align: center;
    }
    .status.success {
      background: #d4edda;
      color: #155724;
    }
    .status.error {
      background: #f8d7da;
      color: #721c24;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    <form id="inputForm">
      <label for="userInput">${prompt}</label>
      <input 
        type="text" 
        id="userInput" 
        name="userInput" 
        placeholder="${placeholder}"
        autofocus
        autocomplete="off"
      />
      <button type="submit">Submit</button>
    </form>
    <div id="status"></div>
  </div>
  <script>
    const form = document.getElementById('inputForm');
    const input = document.getElementById('userInput');
    const status = document.getElementById('status');
    const inputId = '${inputId}';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = input.value.trim();
      
      if (!value) {
        status.textContent = 'Please enter a value';
        status.className = 'status error';
        return;
      }

      try {
        const response = await fetch('/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: inputId, value: value })
        });

        if (response.ok) {
          status.textContent = 'Submitted! You can close this window.';
          status.className = 'status success';
          input.disabled = true;
          form.querySelector('button').disabled = true;
        } else {
          throw new Error('Failed to submit');
        }
      } catch (error) {
        status.textContent = 'Error submitting. Please try again.';
        status.className = 'status error';
      }
    });

    // Focus input on load
    input.focus();
  </script>
</body>
</html>
        `;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } else if (req.method === 'POST' && url.pathname === '/submit') {
        // Handle input submission
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const { id, value } = JSON.parse(body);
            const pending = pendingInputs.get(id);
            if (pending) {
              pendingInputs.delete(id);
              pending.resolve(value);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Input ID not found' }));
            }
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid request' }));
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    inputServer.listen(inputPort, () => {
      console.log(`[Browser Input] Server started on http://localhost:${inputPort}`);
      resolve();
    });
  });
}

/**
 * Stop the input server
 */
export async function stopInputServer(): Promise<void> {
  if (inputServer) {
    return new Promise((resolve) => {
      inputServer!.close(() => {
        inputServer = null;
        console.log('[Browser Input] Server stopped');
        resolve();
      });
    });
  }
}
