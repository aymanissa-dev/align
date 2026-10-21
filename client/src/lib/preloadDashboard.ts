/** Start the dashboard chunk while the sign-in form is on screen. */
export function preloadDashboard(): void {
  void import('../pages/DashboardPage.tsx')
}
