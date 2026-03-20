interface TreeElement {
  id: string;
  role?: string;
  label?: string;
  testID?: string;
  value?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  children?: TreeElement[];
}

let elementCounter = 0;

/**
 * Get the accessibility tree of the currently visible screen.
 *
 * Walks the React fiber tree via __REACT_DEVTOOLS_GLOBAL_HOOK__ to extract
 * accessibility roles, labels, testIDs, and bounds.
 */
export async function getAccessibilityTree(
  options?: { maxDepth?: number },
): Promise<{ elements: TreeElement[] }> {
  const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || !hook.renderers) {
    return { elements: [] };
  }

  elementCounter = 0;
  const elements: TreeElement[] = [];

  for (const [, renderer] of hook.renderers) {
    const roots = hook.getFiberRoots?.(renderer) ?? new Set();
    for (const root of roots) {
      const fiber = root.current;
      if (fiber?.child) {
        walkFiber(fiber.child, elements, 0, options?.maxDepth ?? 50);
      }
    }
  }

  return { elements };
}

function walkFiber(
  fiber: any,
  elements: TreeElement[],
  depth: number,
  maxDepth: number,
): void {
  if (!fiber || depth > maxDepth) return;

  const props = fiber.memoizedProps;
  if (props && typeof props === "object") {
    const hasA11y =
      props.accessible ||
      props.accessibilityRole ||
      props.accessibilityLabel ||
      props.testID ||
      props["aria-label"] ||
      props.role;

    if (hasA11y) {
      const element: TreeElement = {
        id: `e${++elementCounter}`,
        role: props.accessibilityRole || props.role,
        label: props.accessibilityLabel || props["aria-label"],
        testID: props.testID,
        value: props.accessibilityValue?.text || props.value,
      };

      const stateNode = fiber.stateNode;
      if (stateNode && typeof stateNode.measure === "function") {
        try {
          stateNode.measure(
            (
              x: number,
              y: number,
              width: number,
              height: number,
              pageX: number,
              pageY: number,
            ) => {
              element.bounds = { x: pageX, y: pageY, width, height };
            },
          );
        } catch {}
      }

      const children: TreeElement[] = [];
      if (fiber.child) {
        walkFiber(fiber.child, children, depth + 1, maxDepth);
      }
      if (children.length > 0) {
        element.children = children;
      }

      elements.push(element);
    } else {
      if (fiber.child) {
        walkFiber(fiber.child, elements, depth, maxDepth);
      }
    }
  } else {
    if (fiber.child) {
      walkFiber(fiber.child, elements, depth, maxDepth);
    }
  }

  if (fiber.sibling) {
    walkFiber(fiber.sibling, elements, depth, maxDepth);
  }
}
