import { z } from 'zod';

/**
 * The kind of tunnel client connecting to the MCP tunnel server.
 *
 * - `dev-server`: an Expo CLI dev server. Project-scoped; identified by its
 *   project root and dev server URL.
 * - `orbit`: an Expo Orbit instance. Machine-scoped (no project or dev server);
 *   identified by a stable machine id.
 */
export const TunnelClientKind = {
  DevServer: 'dev-server',
  Orbit: 'orbit',
} as const;

export const DevServerHandshakeSchema = z.object({
  kind: z.literal(TunnelClientKind.DevServer),
  projectRoot: z.string(),
  devServerUrl: z.url(),
});
export type DevServerHandshake = z.infer<typeof DevServerHandshakeSchema>;

export const OrbitHandshakeSchema = z.object({
  kind: z.literal(TunnelClientKind.Orbit),
  /** Stable identifier for the machine running Orbit. Distinguishes multiple machines on one account. */
  machineId: z.string(),
  /** Orbit CLI/app version, for diagnostics. */
  orbitVersion: z.string().optional(),
});
export type OrbitHandshake = z.infer<typeof OrbitHandshakeSchema>;

/**
 * The handshake a tunnel client sends when it connects to the tunnel server.
 * Discriminated by `kind`.
 */
export const TunnelClientHandshakeSchema = z.discriminatedUnion('kind', [
  DevServerHandshakeSchema,
  OrbitHandshakeSchema,
]);
export type TunnelClientHandshake = z.infer<typeof TunnelClientHandshakeSchema>;

/**
 * Parse raw handshake params, tolerating legacy clients (mcp-tunnel < 0.4) that
 * send `{ projectRoot, devServerUrl }` with no `kind`. Such payloads are treated
 * as `dev-server`. Intended for the tunnel server (e.g. `@expo/universe`).
 */
export function parseTunnelClientHandshake(raw: unknown): TunnelClientHandshake {
  if (raw != null && typeof raw === 'object' && !('kind' in raw)) {
    return TunnelClientHandshakeSchema.parse({ ...raw, kind: TunnelClientKind.DevServer });
  }
  return TunnelClientHandshakeSchema.parse(raw);
}

/**
 * The client-side constructor options that describe who the tunnel client is.
 * Either pass a full `handshake` descriptor, or the legacy `projectRoot` +
 * `devServerUrl` pair (which is treated as a `dev-server` client).
 */
export type TunnelClientHandshakeOptions = {
  handshake?: TunnelClientHandshake;
  projectRoot?: string;
  devServerUrl?: string;
};

/**
 * Resolve constructor options into a concrete {@link TunnelClientHandshake}.
 * A provided `handshake` wins; otherwise the legacy `projectRoot`/`devServerUrl`
 * pair is used. Throws when neither form is supplied.
 */
export function resolveTunnelClientHandshake(
  options: TunnelClientHandshakeOptions
): TunnelClientHandshake {
  if (options.handshake) {
    return options.handshake;
  }
  if (options.projectRoot != null && options.devServerUrl != null) {
    return {
      kind: TunnelClientKind.DevServer,
      projectRoot: options.projectRoot,
      devServerUrl: options.devServerUrl,
    };
  }
  throw new Error(
    'A tunnel client requires either a `handshake` descriptor or both `projectRoot` and `devServerUrl`.'
  );
}

/**
 * The dev server URL for a handshake, or an empty string for clients (e.g.
 * `orbit`) that are not associated with a dev server.
 */
export function handshakeDevServerUrl(handshake: TunnelClientHandshake): string {
  return handshake.kind === TunnelClientKind.DevServer ? handshake.devServerUrl : '';
}
