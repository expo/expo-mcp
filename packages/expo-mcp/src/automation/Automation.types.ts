export interface AutomationResult<TData extends Record<string, any>> {
  success: boolean;
  error?: string;
  duration: number;
  data: TData;
  /** verbose output when `verbose` is `true` */
  verboseOutput?: string;
}

export interface AutomationConstructorParamsBase {
  appId: string;
  deviceId: string;
  verbose?: boolean;
}

export interface IAutomation {
  tapAsync({ x, y }: { x: number; y: number }): Promise<AutomationResult<any>>;
  takeFullScreenshotAsync({ outputPath }: { outputPath: string }): Promise<string>;

  findViewByTestIDAsync(testID: string): Promise<AutomationResult<any>>;
  tapByTestIDAsync(testID: string): Promise<AutomationResult<any>>;
  taksScreenshotByTestIDAsync({
    testID,
    outputPath,
  }: {
    testID: string;
    outputPath: string;
  }): Promise<string>;
}
