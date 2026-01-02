/**
 * Helper for reading user input from keyboard during integration tests
 *
 * This helper allows tests to pause and wait for user input, which is useful
 * for integration tests that require manual interaction (e.g., testing with
 * real phone apps or developer apps).
 *
 * For better compatibility with Vitest, use the browser-based helpers from
 * browser-input-helper.ts which open a browser window for input.
 */

import * as readline from 'node:readline';

export type UserInputOptions = {
  prompt?: string;
  timeout?: number; // Timeout in milliseconds (0 = no timeout)
  defaultAnswer?: string; // Default answer if user just presses Enter
};

/**
 * Read a single line of input from the user
 *
 * @param options - Options for reading input
 * @returns Promise that resolves to the user's input (trimmed)
 */
export async function readUserInput(options: UserInputOptions = {}): Promise<string> {
  const { prompt = '> ', timeout = 0, defaultAnswer = '' } = options;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    let resolved = false;
    let timeoutId: NodeJS.Timeout | null = null;

    // Set timeout if specified
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          rl.close();
          resolve(defaultAnswer || '');
        }
      }, timeout);
    }

    rl.question(prompt, (answer) => {
      if (!resolved) {
        resolved = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        rl.close();
        resolve(answer.trim() || defaultAnswer);
      }
    });

    // Handle Ctrl+C
    rl.on('SIGINT', () => {
      if (!resolved) {
        resolved = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        rl.close();
        reject(new Error('User cancelled input'));
      }
    });
  });
}

/**
 * Ask a yes/no question and return a boolean
 *
 * @param question - The question to ask
 * @param options - Options for reading input
 * @returns Promise that resolves to true for yes, false for no
 */
export async function askYesNo(
  question: string,
  options: Omit<UserInputOptions, 'prompt'> = {}
): Promise<boolean> {
  const prompt = `${question} (y/n): `;
  const answer = await readUserInput({ ...options, prompt });
  return answer.toLowerCase().startsWith('y');
}

/**
 * Wait for user to press Enter to continue
 *
 * @param message - Optional message to display
 */
export async function waitForEnter(message = 'Press Enter to continue...'): Promise<void> {
  await readUserInput({ prompt: `${message}\n> ` });
}

/**
 * Display a message and wait for user confirmation
 *
 * @param message - Message to display
 * @param options - Options for reading input
 * @returns Promise that resolves when user confirms
 */
export async function waitForConfirmation(
  message: string,
  options: UserInputOptions = {}
): Promise<void> {
  const prompt = options.prompt || `${message}\nPress Enter when ready...\n> `;
  await readUserInput({ ...options, prompt });
}
