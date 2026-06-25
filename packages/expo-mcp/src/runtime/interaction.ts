import { findNodeHandle, PixelRatio } from "react-native";

/**
 * Find an element by testID or elementId in the React fiber tree,
 * then return its native host instance.
 */
function findHostInstance(identifier: {
  elementId?: string;
  testID?: string;
}): any {
  const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) throw new Error("React DevTools hook not available");

  for (const [, renderer] of hook.renderers) {
    const roots = hook.getFiberRoots?.(renderer) ?? new Set();
    for (const root of roots) {
      const found = searchFiber(root.current, identifier);
      if (found) return found;
    }
  }
  throw new Error(`Element not found: ${JSON.stringify(identifier)}`);
}

function searchFiber(
  fiber: any,
  identifier: { elementId?: string; testID?: string },
): any {
  if (!fiber) return null;

  const props = fiber.memoizedProps;
  if (props && identifier.testID && props.testID === identifier.testID) {
    return fiber.stateNode;
  }

  let result = searchFiber(fiber.child, identifier);
  if (result) return result;

  result = searchFiber(fiber.sibling, identifier);
  return result;
}

/**
 * Find the root host instance (the top-level native view) for full-screen capture.
 */
function findRootHostInstance(): any {
  const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) throw new Error("React DevTools hook not available");

  for (const [, renderer] of hook.renderers) {
    const roots = hook.getFiberRoots?.(renderer) ?? new Set();
    for (const root of roots) {
      let fiber = root.current;
      while (fiber) {
        if (fiber.stateNode && typeof fiber.stateNode.measure === "function") {
          return fiber.stateNode;
        }
        fiber = fiber.child;
      }
    }
  }
  throw new Error("No root host instance found");
}

export async function typeText(params: {
  elementId?: string;
  testID?: string;
  text: string;
  clear?: boolean;
  submit?: boolean;
}): Promise<{ success: boolean }> {
  const instance = findHostInstance(params);
  if (!instance) {
    return { success: false };
  }

  if (typeof instance.focus === "function") {
    instance.focus();
  }

  if (params.clear) {
    if (instance.props?.onChangeText) {
      instance.props.onChangeText("");
    }
  }

  if (instance.props?.onChangeText) {
    instance.props.onChangeText(
      params.clear ? params.text : (instance.props.value ?? "") + params.text,
    );
  }

  if (params.submit && instance.props?.onSubmitEditing) {
    instance.props.onSubmitEditing({ nativeEvent: { text: params.text } });
  }

  return { success: true };
}

export async function scroll(params: {
  elementId?: string;
  testID?: string;
  direction: "up" | "down" | "left" | "right";
  amount?: number;
  toEnd?: boolean;
}): Promise<{ success: boolean }> {
  const instance = findHostInstance(params);
  if (!instance) {
    return { success: false };
  }

  const amount = params.amount ?? 500;

  if (params.toEnd && typeof instance.scrollToEnd === "function") {
    instance.scrollToEnd({ animated: false });
  } else if (typeof instance.scrollTo === "function") {
    const offsets: Record<string, { x: number; y: number }> = {
      up: { x: 0, y: -amount },
      down: { x: 0, y: amount },
      left: { x: -amount, y: 0 },
      right: { x: amount, y: 0 },
    };
    instance.scrollTo({ ...offsets[params.direction], animated: false });
  }

  return { success: true };
}

/**
 * Capture a screenshot from inside the app using react-native-view-shot.
 * Works on physical devices — key advantage over xcodebuild/adb.
 */
export async function takeScreenshot(params: {
  testID?: string;
}): Promise<{ base64: string; width: number; height: number }> {
  try {
    const { captureRef: capture } = require("react-native-view-shot");

    let ref: any;
    if (params.testID) {
      ref = findHostInstance({ testID: params.testID });
    } else {
      ref = findRootHostInstance();
    }

    const nodeHandle = findNodeHandle(ref);
    if (!nodeHandle) throw new Error("Could not get native handle");

    const uri = await capture(nodeHandle, {
      format: "png",
      quality: 0.8,
      result: "base64",
    });

    return new Promise((resolve, reject) => {
      ref.measure((x: number, y: number, width: number, height: number) => {
        resolve({
          base64: uri,
          width: Math.round(width * PixelRatio.get()),
          height: Math.round(height * PixelRatio.get()),
        });
      });
    });
  } catch (err: any) {
    throw new Error(
      `Screenshot failed: ${err.message}. Install react-native-view-shot for in-app screenshots.`,
    );
  }
}
