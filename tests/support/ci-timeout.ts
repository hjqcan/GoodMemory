const CI_TEST_TIMEOUT_MULTIPLIER = 4;

export function ciTestTimeout(milliseconds: number): number {
  return process.env.CI === "true"
    ? milliseconds * CI_TEST_TIMEOUT_MULTIPLIER
    : milliseconds;
}
