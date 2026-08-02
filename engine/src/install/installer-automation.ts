export const AUTOMATION_RUNTIME_QUERY = "parallaxAutomation";
export const AUTOMATION_RUNTIME_VALUE = "runtime";

export function isAutomationRuntimeLaunch(url: string, webdriver: boolean): boolean {
  const parsed = new URL(url);
  return (
    webdriver && parsed.searchParams.get(AUTOMATION_RUNTIME_QUERY) === AUTOMATION_RUNTIME_VALUE
  );
}

export function authorizeAutomationRuntimeLaunch(url: string): boolean {
  return isAutomationRuntimeLaunch(url, navigator.webdriver);
}
