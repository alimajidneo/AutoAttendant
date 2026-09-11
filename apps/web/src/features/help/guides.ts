export type Guide = {
  id: string
  title: string
  audience: string
  summary: string
  steps: { title: string; detail: string }[]
  outcome: string
  notes: { title: string; detail: string }[]
}

export const guides: Guide[] = [
  {
    id: 'start', title: 'Set up your receptionist', audience: 'Owner or manager',
    summary: 'Start here to prepare a receptionist for your business, then make a browser call.',
    steps: [
      { title: 'Sign in', detail: 'Choose Continue with Google. Use an account you control for work. Signing in identifies you in DeskRoute; connecting calendars is a separate step.' },
      { title: 'Choose your workspace', detail: 'If an owner invited you, open Workspaces and join using their invitation code. Otherwise, complete onboarding for your receptionist. A personal workspace is for you; a team workspace lets you invite colleagues.' },
      { title: 'Describe the business', detail: 'Open Settings → Business. Enter the business name, description and timezone. Add services if you offer them, then save. General appointments can also be booked without a declared service.' },
      { title: 'Set hours and instructions', detail: 'In Settings → Hours, save the days and times you accept appointments. In Settings → Agent, save the greeting and caller questions. Add common questions and answers on Knowledge.' },
      { title: 'Connect calendars and try a call', detail: 'Follow the calendars guide, then the Test your agent guide. Confirm the appointment appears in the intended provider calendar before using the receptionist with customers.' },
    ],
    outcome: 'Your business details, working hours and receptionist instructions are saved, and you are ready for a controlled browser test.',
    notes: [{ title: 'I only see Workspaces', detail: 'Members use the workspace directory and transfer inbox. Owners and managers can open the business dashboard. Ask the owner to check your role if you need to manage the receptionist.' }],
  },
  {
    id: 'workspaces', title: 'Workspaces and teammates', audience: 'Everyone',
    summary: 'Keep businesses separate and give teammates only the access they need.',
    steps: [
      { title: 'Open Workspaces', detail: 'Use Switch beside the business name at the top of the dashboard. Select an existing workspace or enter a name, type and timezone under Create a workspace.' },
      { title: 'Invite a teammate as the owner', detail: 'In a team workspace, enter the exact email your colleague will use to sign in and select Member or Manager. Create the invitation and copy its code. Share it privately with that colleague; DeskRoute does not email it for you.' },
      { title: 'Accept the invitation', detail: 'Your colleague signs in with the invited email, opens Workspaces, pastes the code under Join a workspace and chooses Join workspace. Codes expire after seven days and work once.' },
      { title: 'Choose the right role', detail: 'A member can view the workspace dashboard, call-log summaries and DeskRoute booking calendar, edit their own routing profile, and receive transfers addressed to them. A manager can also configure the receptionist, open transcripts and recordings, and manage records. Only the owner manages invitations, roles and calendar connections.' },
      { title: 'Check the selected workspace', detail: 'Before changing settings or testing a call, check the business name. Switching workspaces reloads its data in that browser tab. A new workspace starts separately; your personal calendars are not automatically copied into it.' },
    ],
    outcome: 'Each teammate can use their own login to access the intended workspace.',
    notes: [{ title: 'Who can see personal calendar events?', detail: 'Only the workspace owner can view events from the owner-connected external calendars. Managers and members can see shared DeskRoute bookings. Membership does not grant access to someone’s private calendar. Sharing an employee’s own availability with several workspaces is still planned.' }],
  },
  {
    id: 'hours', title: 'Hours and timezones', audience: 'Owner or manager',
    summary: 'Tell the receptionist when appointments may happen.',
    steps: [
      { title: 'Confirm the business timezone', detail: 'Open Settings → Business and check the timezone. Your browser may suggest an initial timezone, but you must confirm the business’s timezone. It does not automatically establish a caller’s timezone.' },
      { title: 'Set weekly hours', detail: 'Open Settings → Hours. Set opening and closing times for each working day and mark other days closed. Save your changes.' },
      { title: 'Review exceptions and booking limits', detail: 'Adjust date exceptions, minimum notice and how far ahead someone may book. A free calendar slot can still be unavailable if it falls outside these rules.' },
      { title: 'Test a specific time', detail: 'Ask the test agent for a particular date and time, stating the timezone. Try both a free slot within hours and a slot blocked by a selected calendar event.' },
    ],
    outcome: 'The receptionist checks business hours and selected calendars together before offering a booking.',
    notes: [{ title: 'Why is 11 AM unavailable?', detail: 'Check the requested date and timezone, opening hours, minimum notice, appointment duration and busy events in every selected calendar. Asking for a specific time is a better test than only accepting the first suggested slots.' }],
  },
  {
    id: 'agent', title: 'Instructions, FAQs and intake', audience: 'Owner or manager',
    summary: 'Give the receptionist useful answers and specify what to ask callers.',
    steps: [
      { title: 'Set the conversation style', detail: 'Open Settings → Agent. Edit the agent name, greeting, farewell and instructions for questions it cannot answer. Save the changes.' },
      { title: 'Choose booking questions', detail: 'Under Appointment intake, enter the details the receptionist should ask for in Questions to ask, one question per line. Ask only for details needed to arrange the appointment.' },
      { title: 'Add approved answers', detail: 'Open Knowledge and add questions with clear answers, such as your location, demo format or cancellation policy. Keep answers current and avoid including private internal information.' },
      { title: 'Review unanswered questions', detail: 'Open Questions to review items the receptionist could not answer. Respond and update your knowledge content where appropriate.' },
      { title: 'Listen to a test', detail: 'Start a new browser test after saving. Ask a known question, an unknown question and a general appointment request. Check that the receptionist collects the intended details.' },
    ],
    outcome: 'The receptionist has approved business knowledge and a clear booking intake.',
    notes: [{ title: 'Can it record or summarize calls?', detail: 'Normal calls support saved transcripts and a short summary based on the transcript. Audio recording is optional and needs configured storage. Browser tests skip saved call histories, summaries and audio recordings. The agent does not currently analyze uploaded audio files.' }, { title: 'How do I give it more context?', detail: 'Use Settings → Business for your description and Knowledge → Add FAQ for approved answers. A dedicated business context editor and reviewed document imports are planned; files on your computer are not automatically available to the agent.' }, { title: 'Where do I change the voice or model?', detail: 'The speech voice and model are currently configured by the installation administrator. Those controls are not yet available in Settings. Changing instructions does not change the underlying voice provider.' }],
  },
  {
    id: 'calendars', title: 'Connect calendars', audience: 'Workspace owner',
    summary: 'Connect Google, Outlook.com, or Microsoft 365 accounts and choose which calendars affect appointments.',
    steps: [
      { title: 'Open calendar settings', detail: 'Go to Settings → Connections → Calendars. Choose Google or Microsoft. Your administrator must configure that provider before its connection button works.' },
      { title: 'Authorize the intended account', detail: 'Choose the Gmail, Google Workspace, Outlook.com, or Microsoft 365 account whose calendar you want to connect and review the requested access. This does not change your DeskRoute sign-in.' },
      { title: 'Add another account', detail: 'In the same panel, choose Google or Microsoft again and select the additional account. Confirm that every intended account appears with its provider name.' },
      { title: 'Choose calendars and save', detail: 'Choose one Booking calendar for new appointments. Under Calendars that block free time, select the calendars that should prevent double booking. Click Save calendar settings. A connected account with zero calendars included needs a selection here.' },
      { title: 'Check display and availability', detail: 'Open Appointments and choose Refresh calendar. Use the source legend below the calendar to identify accounts. Add a busy event in the second account and confirm the receptionist will not book over it.' },
    ],
    outcome: 'Selected calendars across connected accounts block availability; new bookings go to your chosen destination.',
    notes: [
      { title: 'A connected account’s event is missing', detail: 'Check that its calendar is selected, save, refresh and navigate to the correct date. Events created directly in Google or Outlook appear in the calendar and daily agenda; Upcoming and Past contain DeskRoute bookings.' },
      { title: 'Google blocks access', detail: 'If the Google consent app is in testing, its administrator must add your email as a test user. A redirect_uri_mismatch error requires the administrator to correct the registered callback URL. Repeatedly signing in will not fix either setting.' },
      { title: 'Microsoft asks for administrator approval', detail: 'A work Microsoft 365 tenant can restrict third-party apps. Ask its administrator to review delegated User.Read and Calendars.ReadWrite access. Do not request tenant-wide application permissions.' },
    ],
  },
  {
    id: 'appointments', title: 'Manage appointments', audience: 'Owner or manager',
    summary: 'Find upcoming bookings, check the day’s agenda and remove old appointments.',
    steps: [
      { title: 'Open Appointments', detail: 'Use the month controls to find a date and select its day to view the agenda. The workspace owner also sees events from selected external calendars, identified by their source colors.' },
      { title: 'Review upcoming and past bookings', detail: 'Upcoming appointments include bookings that have not ended. After the appointment’s end time it belongs in Past appointments. Calendar event display and these booking lists serve different purposes.' },
      { title: 'Cancel an upcoming booking', detail: 'Choose Cancel on the DeskRoute appointment, review the confirmation and confirm. This removes the linked Google or Microsoft event and keeps the booking marked as cancelled.' },
      { title: 'Delete a past booking', detail: 'Choose Delete beside the past DeskRoute booking in the daily agenda or in Past appointments, then review the confirmation. It removes the linked provider event and the DeskRoute appointment record. Separate call records are not deleted.' },
      { title: 'Refresh after outside changes', detail: 'If you changed Google Calendar or Outlook directly, choose Refresh calendar. If deletion fails, keep the record, check the original connected account and retry after restoring access.' },
    ],
    outcome: 'Your upcoming bookings and past history are easier to manage, with linked calendar deletions handled together.',
    notes: [{ title: 'Are all outside changes synchronized?', detail: 'Full rescheduling and external time-change synchronization are still being completed. Do not assume that moving a provider event updates every DeskRoute booking field. Verify both records when a time changes.' }],
  },
  {
    id: 'notifications', title: 'Check notifications', audience: 'Owner or manager',
    summary: 'Review recent bookings, cancellations and questions that need attention.',
    steps: [
      { title: 'Open the bell', detail: 'Choose the notification bell in the dashboard header to see recent activity for the selected workspace.' },
      { title: 'Open an item', detail: 'Select a notification to mark that version as read and open its related page. Read the booking or question before taking action.' },
      { title: 'Refresh when needed', detail: 'Use Refresh to check for new activity. Use Mark all read to clear the displayed unread items. Your read status is separate from your teammates’.' },
      { title: 'Optional Slack alerts', detail: 'The workspace owner opens Settings → Connections → Slack, installs DeskRoute, invites it to one channel, selects that channel and enables specific alert types. Use Send test after saving.' },
    ],
    outcome: 'You can find recent items requiring attention without leaving the dashboard.',
    notes: [{ title: 'What does Slack receive?', detail: 'Enabled Slack alerts contain a generic event type only. Caller names, phone numbers, appointment times, calendar titles, transcripts and recordings stay in DeskRoute. Email, SMS and browser push alerts are not implemented.' }],
  },
  {
    id: 'testing', title: 'Test your agent', audience: 'Owner or manager',
    summary: 'Make a browser voice call before connecting a real telephone number.',
    steps: [
      { title: 'Prepare a controlled test', detail: 'Check that you are in the correct workspace and choose a calendar where a test booking is acceptable. Browser tests can create real appointments, so choose a time you can remove afterward.' },
      { title: 'Start the test', detail: 'On the dashboard, open the agent test control, start the call and allow microphone access. Use headphones to avoid feedback. The installation’s voice worker must be running.' },
      { title: 'Try the main journeys', detail: 'Ask an FAQ, ask an unknown question, then request an appointment at a specific date, time and timezone. Include a time that is busy in your second connected account.' },
      { title: 'Verify the result', detail: 'End the test and refresh Appointments. Check that the booking exists in the chosen Google or Microsoft calendar and that busy times from every selected account were rejected. Cancel the test appointment when finished.' },
    ],
    outcome: 'You have checked the voice conversation and real calendar behavior before a customer pilot.',
    notes: [
      { title: 'Does this test cost money?', detail: 'It does not need a telephone number or carrier call. It still uses LiveKit and the configured speech and AI services. Usage may fit free allowances, but it is not guaranteed free. Your administrator can check each provider’s usage dashboard.' },
      { title: 'The agent does not answer', detail: 'Check microphone permission and audio output. Ask the installation administrator to check the API and voice worker. Reload after a configuration change, then begin a new test.' },
    ],
  },
  {
    id: 'transfers', title: 'Test a teammate handoff', audience: 'Manager and receiving teammate',
    summary: 'Use two signed-in browser sessions to try a real audio handoff without a phone number.',
    steps: [
      { title: 'Prepare the recipient', detail: 'The receiving teammate opens the same team workspace. Under People & routing, they save the name callers can ask for, a department and Available for browser transfers. Keep that page open.' },
      { title: 'Start the caller session', detail: 'In another signed-in browser session, the owner or manager starts a dashboard agent test. Ask to speak to the recipient by name or department and agree to the transfer.' },
      { title: 'Check the incoming request', detail: 'The recipient chooses Check incoming transfers. This inbox is refreshed manually. A request expires after 90 seconds, so check promptly.' },
      { title: 'Accept and connect audio', detail: 'Choose Accept & connect microphone and allow microphone access. The AI leaves only after the recipient’s microphone connects. Speak to each other to confirm audio works in both directions.' },
      { title: 'End both sessions', detail: 'End the test on both sides. Start a new test to check decline or no-answer behavior; only one transfer attempt is supported per test. The agent should continue if the handoff fails.' },
    ],
    outcome: 'The caller and teammate can speak directly after an accepted browser handoff.',
    notes: [
      { title: 'Does Available mean they are online or off the phone?', detail: 'No. It is a manual preference, not live telephone or Teams presence. The teammate still needs to accept and connect their microphone.' },
      { title: 'Can I transfer to a phone, Slack or Teams?', detail: 'This test connects browsers. Telephone transfer and Slack or Teams approval integrations are planned. The browser test still uses provider resources and any applicable allowance or usage charges.' },
    ],
  },
]
