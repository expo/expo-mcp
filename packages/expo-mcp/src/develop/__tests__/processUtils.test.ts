import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ProcessPromise } from 'zx';

import { streamProcessOutput } from '../processUtils.js';

/**
 * Creates a mock ProcessPromise with controllable streams and child process.
 */
function createMockProcessPromise() {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const childProcess = new EventEmitter() as ChildProcess;

  const processPromise = {
    stdout,
    stderr,
    child: childProcess,
    kill: mock((signal?: NodeJS.Signals | number) => {
      const signalName = typeof signal === 'number' ? `SIG${signal}` : signal;
      setTimeout(() => {
        childProcess.emit('close', null, signalName);
      }, 10);
      return true;
    }),
    catch: mock((handler: (error: Error) => void) => {
      return processPromise;
    }),
  } as unknown as ProcessPromise;

  return { processPromise, stdout, stderr, childProcess };
}

describe('streamProcessOutput', () => {
  beforeEach(() => {
    mock.restore();
  });

  afterEach(() => {
    mock.restore();
  });

  it('should stream stdout and stderr lines to callbacks', async () => {
    const { processPromise, stdout, stderr } = createMockProcessPromise();
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const promise = streamProcessOutput(processPromise, {
      durationMs: 100,
      onStdoutLine: (line) => stdoutLines.push(line),
      onStderrLine: (line) => stderrLines.push(line),
      processName: 'test process',
    });

    // Emit some lines
    stdout.push('stdout line 1\n');
    stdout.push('stdout line 2\n');
    stderr.push('stderr line 1\n');
    stderr.push('stderr line 2\n');

    // Close streams
    stdout.push(null);
    stderr.push(null);

    await promise;

    expect(stdoutLines).toEqual(['stdout line 1', 'stdout line 2']);
    expect(stderrLines).toEqual(['stderr line 1', 'stderr line 2']);
  });

  it('should terminate process after duration elapses', async () => {
    const { processPromise, stdout, stderr } = createMockProcessPromise();
    const durationMs = 100;

    const promise = streamProcessOutput(processPromise, {
      durationMs,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
    });

    // Keep streams open
    stdout.push('line 1\n');
    stderr.push('line 1\n');

    await promise;

    // Verify kill was called
    expect(processPromise.kill).toHaveBeenCalled();
  });

  it('should send SIGINT after timeout and SIGKILL as fallback', async () => {
    const { processPromise, stdout, stderr } = createMockProcessPromise();
    const durationMs = 50;

    const promise = streamProcessOutput(processPromise, {
      durationMs,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
    });

    // Keep streams open
    stdout.push('line 1\n');
    stderr.push('line 1\n');

    await promise;

    // First call should be SIGINT (after durationMs)
    expect(processPromise.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('should reject when process emits error event', async () => {
    const { processPromise, childProcess } = createMockProcessPromise();

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
    });

    // Emit error
    childProcess.emit('error', new Error('Process spawn failed'));

    await expect(promise).rejects.toThrow('Failed to start test process: Process spawn failed');
  });

  it('should reject when process exits with non-zero code', async () => {
    const { processPromise, stdout, stderr, childProcess } = createMockProcessPromise();

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
    });

    // Emit some lines then close with error code
    stdout.push('line 1\n');
    stderr.push('line 1\n');

    // Process exits unexpectedly with code 1
    setTimeout(() => {
      childProcess.emit('close', 1, null);
    }, 10);

    await expect(promise).rejects.toThrow(
      'test process exited with code 1 before the collection window elapsed.'
    );
  });

  it('should resolve successfully when process exits with code 0', async () => {
    const { processPromise, stdout, stderr, childProcess } = createMockProcessPromise();
    const stdoutLines: string[] = [];

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: (line) => stdoutLines.push(line),
      onStderrLine: () => {},
      processName: 'test process',
    });

    // Emit some lines
    stdout.push('line 1\n');
    stdout.push('line 2\n');
    stdout.push(null);
    stderr.push(null);

    // Process exits cleanly
    setTimeout(() => {
      childProcess.emit('close', 0, null);
    }, 10);

    await promise;

    expect(stdoutLines).toEqual(['line 1', 'line 2']);
  });

  it('should reject when stdout stream errors', async () => {
    const { processPromise, stdout } = createMockProcessPromise();

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
    });

    // Emit error on stdout
    setTimeout(() => {
      stdout.destroy(new Error('Stream read error'));
    }, 10);

    await expect(promise).rejects.toThrow(
      'Failed to read stdout output from test process: Stream read error'
    );
  });

  it('should reject when stderr stream errors', async () => {
    const { processPromise, stderr } = createMockProcessPromise();

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
    });

    // Emit error on stderr
    setTimeout(() => {
      stderr.destroy(new Error('Stream read error'));
    }, 10);

    await expect(promise).rejects.toThrow(
      'Failed to read stderr output from test process: Stream read error'
    );
  });

  it('should reject when stdout is not available', async () => {
    const { processPromise } = createMockProcessPromise();
    processPromise.stdout = null as any;

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
    });

    await expect(promise).rejects.toThrow('Failed to capture test process output streams.');
    expect(processPromise.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('should reject when stderr is not available', async () => {
    const { processPromise } = createMockProcessPromise();
    processPromise.stderr = null as any;

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
    });

    await expect(promise).rejects.toThrow('Failed to capture test process output streams.');
    expect(processPromise.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('should reject when child process handle is not available', async () => {
    const { processPromise, stdout, stderr } = createMockProcessPromise();
    processPromise.child = null as any;

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
    });

    // Close streams to prevent hanging
    stdout.push(null);
    stderr.push(null);

    await expect(promise).rejects.toThrow('Failed to acquire test process child process handle.');
  });

  it('should handle empty lines correctly', async () => {
    const { processPromise, stdout, stderr, childProcess } = createMockProcessPromise();
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: (line) => stdoutLines.push(line),
      onStderrLine: (line) => stderrLines.push(line),
      processName: 'test process',
    });

    // Emit lines including empty ones
    stdout.push('line 1\n');
    stdout.push('\n');
    stdout.push('line 2\n');
    stderr.push('error 1\n');
    stderr.push('\n');
    stdout.push(null);
    stderr.push(null);

    setTimeout(() => {
      childProcess.emit('close', 0, null);
    }, 10);

    await promise;

    expect(stdoutLines).toEqual(['line 1', '', 'line 2']);
    expect(stderrLines).toEqual(['error 1', '']);
  });

  it('should stop reading streams after process is terminated by timeout', async () => {
    const { processPromise, stdout, stderr } = createMockProcessPromise();
    const stdoutLines: string[] = [];
    const durationMs = 50;

    const promise = streamProcessOutput(processPromise, {
      durationMs,
      onStdoutLine: (line) => stdoutLines.push(line),
      onStderrLine: () => {},
      processName: 'test process',
    });

    // Emit lines before timeout
    stdout.push('line 1\n');
    stdout.push('line 2\n');

    // Wait for timeout and termination
    await promise;

    // Try to push more lines after termination (should not be captured)
    stdout.push('line 3\n');
    stdout.push(null);
    stderr.push(null);

    // Give some time for any potential async processing
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Should only have lines before termination
    expect(stdoutLines.length).toBeLessThanOrEqual(2);
  });

  it('should allow process exit with signal when stop was requested', async () => {
    const { processPromise, stdout, stderr } = createMockProcessPromise();

    const promise = streamProcessOutput(processPromise, {
      durationMs: 50,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
    });

    stdout.push('line 1\n');
    stderr.push('line 1\n');

    // Wait for the timeout to trigger SIGINT
    await promise;

    // Should resolve successfully (not reject) since we requested the stop
    expect(processPromise.kill).toHaveBeenCalled();
  });

  it('should terminate process when abort signal is triggered', async () => {
    const { processPromise, stdout } = createMockProcessPromise();
    const abortController = new AbortController();
    const stdoutLines: string[] = [];

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: (line) => stdoutLines.push(line),
      onStderrLine: () => {},
      processName: 'test process',
      signal: abortController.signal,
    });

    // Emit some lines
    stdout.push('line 1\n');
    stdout.push('line 2\n');

    // Abort after a short delay
    setTimeout(() => {
      abortController.abort();
    }, 20);

    await promise;

    // Verify process was killed
    expect(processPromise.kill).toHaveBeenCalledWith('SIGINT');
    // Should have captured lines before abort
    expect(stdoutLines.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject when signal is already aborted', async () => {
    const { processPromise } = createMockProcessPromise();
    const abortController = new AbortController();
    abortController.abort();

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
      signal: abortController.signal,
    });

    await expect(promise).rejects.toThrow('test process was aborted before it could start.');
    expect(processPromise.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('should clean up abort listener on successful completion', async () => {
    const { processPromise, stdout, stderr, childProcess } = createMockProcessPromise();
    const abortController = new AbortController();
    const removeEventListenerSpy = mock(
      abortController.signal.removeEventListener.bind(abortController.signal)
    );

    // Replace removeEventListener with our spy
    abortController.signal.removeEventListener = removeEventListenerSpy as any;

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
      signal: abortController.signal,
    });

    stdout.push('line 1\n');
    stdout.push(null);
    stderr.push(null);

    setTimeout(() => {
      childProcess.emit('close', 0, null);
    }, 10);

    await promise;

    // Verify abort listener was removed
    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('should not interfere with timeout when abort signal is provided but not triggered', async () => {
    const { processPromise, stdout, stderr } = createMockProcessPromise();
    const abortController = new AbortController();
    const durationMs = 50;

    const promise = streamProcessOutput(processPromise, {
      durationMs,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      processName: 'test process',
      signal: abortController.signal,
    });

    stdout.push('line 1\n');
    stderr.push('line 1\n');

    // Wait for timeout (not abort)
    await promise;

    // Should complete via timeout, not abort
    expect(processPromise.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('should handle abort during stream reading', async () => {
    const { processPromise, stdout } = createMockProcessPromise();
    const abortController = new AbortController();
    const stdoutLines: string[] = [];

    const promise = streamProcessOutput(processPromise, {
      durationMs: 1000,
      onStdoutLine: (line) => {
        stdoutLines.push(line);
      },
      onStderrLine: () => {},
      processName: 'test process',
      signal: abortController.signal,
    });

    // Emit a few lines
    stdout.push('line 1\n');
    stdout.push('line 2\n');
    stdout.push('line 3\n');

    // Abort after the initial lines
    setTimeout(() => {
      abortController.abort();
    }, 20);

    await promise;

    // Verify abort triggered process termination
    expect(processPromise.kill).toHaveBeenCalledWith('SIGINT');
    // Should have captured the lines before abort
    expect(stdoutLines.length).toBeGreaterThanOrEqual(1);
  });
});
