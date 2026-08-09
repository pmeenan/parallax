export const AUTOMATION_RUNTIME_QUERY = "parallaxAutomation";
export const AUTOMATION_RUNTIME_VALUE = "runtime";
export const AUTOMATION_GAMEPLAY_INPUT_QUERY = "parallaxAutomationGameplayInput";
export const AUTOMATION_GAMEPLAY_INPUT_VALUE = "smoke";

export function isAutomationRuntimeLaunch(url: string, webdriver: boolean): boolean {
  const parsed = new URL(url);
  return (
    webdriver && parsed.searchParams.get(AUTOMATION_RUNTIME_QUERY) === AUTOMATION_RUNTIME_VALUE
  );
}

export function authorizeAutomationRuntimeLaunch(url: string): boolean {
  return isAutomationRuntimeLaunch(url, navigator.webdriver);
}

export function isAutomationGameplayInputLaunch(url: string, webdriver: boolean): boolean {
  const parsed = new URL(url);
  return (
    isAutomationRuntimeLaunch(url, webdriver) &&
    parsed.searchParams.get(AUTOMATION_GAMEPLAY_INPUT_QUERY) === AUTOMATION_GAMEPLAY_INPUT_VALUE
  );
}

export function authorizeAutomationGameplayInputLaunch(url: string): boolean {
  return isAutomationGameplayInputLaunch(url, navigator.webdriver);
}
