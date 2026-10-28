// The slices of users / sessions a Home card can open (admin_list_users'
// p_segment and admin_list_sessions' p_period / status in
// 0045_dashboard_drilldowns.sql), with the label the list shows for each.

export const USER_SEGMENTS: Record<string, string> = {
  joined_today: "Joined today",
  joined_week: "Joined this week",
  joined_month: "Joined this month",
  active_7d: "Active in the last 7 days",
  interviewed: "Did an interview",
  never_interviewed: "Never did an interview",
  desktop_windows: "Desktop app on Windows",
  desktop_mac: "Desktop app on Mac",
  android: "Phone · Android",
  ios: "Phone · iPhone",
  computer_browser: "Browser on a computer",
  website_only: "Website only",
};

export const SESSION_PERIODS: Record<string, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
};

export const SESSION_STATUSES: Record<string, string> = {
  failed: "Ended early or timed out",
  completed: "Completed",
  active: "Running now",
  expired: "Timed out",
  terminated: "Ended early",
};
