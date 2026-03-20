/**
 * Get the current screen from expo-router.
 * Uses the router store directly — no hooks, safe to call outside React.
 */
export function getScreen(): {
  route: string;
  params: Record<string, any>;
  segments: string[];
  navigationStack: string[];
} {
  try {
    const store = getStore();
    if (!store) return defaultScreen();

    const routeInfo = store.getRouteInfo();
    const state = store.state;

    return {
      route: routeInfo?.pathname ?? "/",
      params: routeInfo?.params ?? {},
      segments: routeInfo?.segments ?? [],
      navigationStack: state ? extractStack(state) : ["/"],
    };
  } catch (e) {
    console.warn("[expo-mcp] getScreen error:", e);
    return defaultScreen();
  }
}

/**
 * Get the full route tree from expo-router.
 */
export function getRoutes(): {
  routes: Array<{ path: string; screenName: string }>;
  currentRoute: string;
} {
  try {
    const store = getStore();
    if (!store) return { routes: [], currentRoute: getScreen().route };

    const routeNode = store.routeNode;
    if (routeNode) {
      return {
        routes: collectRoutes(routeNode),
        currentRoute: getScreen().route,
      };
    }

    return { routes: [], currentRoute: getScreen().route };
  } catch (e) {
    console.warn("[expo-mcp] getRoutes error:", e);
    return { routes: [], currentRoute: "/" };
  }
}

/**
 * Navigate to a route using expo-router.
 */
export async function navigate(params: {
  route: string;
  params?: Record<string, any>;
}): Promise<{ success: boolean; currentRoute?: string }> {
  try {
    const { router } = require("expo-router");
    if (params.params) {
      router.push({ pathname: params.route, params: params.params });
    } else {
      router.push(params.route);
    }
    return { success: true };
  } catch (error: any) {
    console.warn("[expo-mcp] navigate error:", error);
    return { success: false };
  }
}

function defaultScreen() {
  return {
    route: "/",
    params: {},
    segments: [] as string[],
    navigationStack: ["/"],
  };
}

// expo-router doesn't expose a public imperative API to read current route state
// outside of React hooks. We access the internal store directly — wrapped in
// try/catch since this internal path may change across expo-router versions.
function getStore(): any {
  try {
    return require("expo-router/build/global-state/router-store").store;
  } catch (e) {
    console.warn("[expo-mcp] Could not load router store:", e);
    return null;
  }
}

function collectRoutes(
  node: any,
  prefix = "",
): Array<{ path: string; screenName: string }> {
  const routes: Array<{ path: string; screenName: string }> = [];

  const path = prefix + (node.route ? `/${node.route}` : "");

  if (node.route && !node.route.startsWith("_")) {
    routes.push({
      path: path || "/",
      screenName: node.route,
    });
  }

  if (node.children) {
    for (const child of node.children) {
      routes.push(...collectRoutes(child, path));
    }
  }

  return routes;
}

function extractStack(state: any, prefix = ""): string[] {
  if (!state?.routes) return [];
  return state.routes
    .map((r: any) => {
      const path = `${prefix}/${r.name}`;
      if (r.state) return extractStack(r.state, path);
      return [path];
    })
    .flat();
}
