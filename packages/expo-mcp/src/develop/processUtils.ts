import { createInterface } from 'node:readline';
import type { ProcessPromise } from 'zx';

export interface StreamProcessOutputOptions {
  /**
   * Duration in milliseconds to collect output before terminating the process.
   */
  durationMs: number;

  /**
   * Callback invoked for each line from stdout.
   */
  onStdoutLine: (line: string) => void;

  /**
   * Callback invoked for each line from stderr.
   */
  onStderrLine: (line: string) => void;

  /**
   * Descriptive name of the process for error messages (e.g., "adb logcat", "iOS simulator log stream").
   */
  processName: string;

  /**
   * Optional AbortSignal to allow early termination of the process.
   */
  signal?: AbortSignal;
}

/**
 * Streams output from a child process, invoking callbacks for each line from stdout and stderr.
 * Automatically manages process lifecycle, cleanup, and timeout handling.
 *
 * Supports early termination via AbortController - pass an AbortSignal in options to allow
 * cancellation before the duration elapses.
 *
 * @param child The zx ProcessPromise from spawning a command
 * @param options Configuration for output streaming
 * @returns Promise that resolves when the collection duration elapses or rejects on error
 */
export async function streamProcessOutput(
  child: ProcessPromise,
  options: StreamProcessOutputOptions
): Promise<void> {
  const { durationMs, onStdoutLine, onStderrLine, processName, signal } = options;

  const stdout = child.stdout;
  const stderr = child.stderr;

  if (!stdout || !stderr) {
    child.kill('SIGTERM');
    throw new Error(`Failed to capture ${processName} output streams.`);
  }

  // Check if already aborted
  if (signal?.aborted) {
    child.kill('SIGTERM');
    throw new Error(`${processName} was aborted before it could start.`);
  }

  // Prevent ProcessPromise rejection when we deliberately terminate the process
  child.catch(() => undefined);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let stopRequested = false;
    let killHandle: NodeJS.Timeout | undefined;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let abortHandler: (() => void) | undefined;
    const readers: ReturnType<typeof createInterface>[] = [];

    const settleSuccess = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const settleError = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      for (const reader of readers) {
        reader.close();
      }
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (killHandle) {
        clearTimeout(killHandle);
      }
      if (abortHandler && signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    const forwardLines = async (
      stream: NodeJS.ReadableStream,
      onLine: (line: string) => void,
      type: 'stdout' | 'stderr'
    ) => {
      const reader = createInterface({ input: stream, crlfDelay: Infinity });
      readers.push(reader);
      try {
        for await (const line of reader) {
          if (settled) {
            break;
          }
          onLine(line);
        }
      } catch (error) {
        if (!settled) {
          const message = error instanceof Error ? error.message : 'Unknown stream read error';
          settleError(new Error(`Failed to read ${type} output from ${processName}: ${message}`));
        }
      } finally {
        reader.close();
      }
    };

    forwardLines(stdout, onStdoutLine, 'stdout');
    forwardLines(stderr, onStderrLine, 'stderr');

    const childProcess = child.child;
    if (!childProcess) {
      settleError(new Error(`Failed to acquire ${processName} child process handle.`));
      return;
    }

    childProcess.once('error', (error: Error) => {
      settleError(new Error(`Failed to start ${processName}: ${error.message}`));
    });

    childProcess.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (!stopRequested && code !== 0 && signal === null) {
        return settleError(
          new Error(
            `${processName} exited with code ${code ?? 'unknown'} before the collection window elapsed.`
          )
        );
      }
      settleSuccess();
    });

    // Set up abort signal listener
    if (signal) {
      abortHandler = () => {
        if (!settled) {
          stopRequested = true;
          child.kill('SIGINT');
        }
      };
      signal.addEventListener('abort', abortHandler);
    }

    killHandle = setTimeout(() => {
      child.kill('SIGKILL');
    }, durationMs + 1000);
    killHandle?.unref?.();

    timeoutHandle = setTimeout(() => {
      stopRequested = true;
      child.kill('SIGINT');
    }, durationMs);
    timeoutHandle?.unref?.();
  });
}
