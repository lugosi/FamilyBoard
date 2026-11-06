Feature: WikiLLM AI tab
  As a family member
  I want one assistant prompt that can update the calendar, plus an inbox drop-box, todos, and Signal
  So we can ask questions and turn messages and forwarded mail into calendar events

  Background:
    Given the board server is running at BASE_URL
    And I open "/"

  Scenario: Board and AI tabs exist
    Then I see main navigation with "Board" and "AI"
    When I select the "AI" tab
    Then I see the heading "WikiLLM"

  Scenario: Assistant setup when Gemini is missing
    Given auth status has geminiConfigured false
    When I open the AI tab
    Then the assistant panel shows setup copy mentioning GEMINI_API_KEY

  Scenario: Single assistant prompt
    Given auth status has geminiConfigured true
    When I open the AI tab
    Then I see one prompt input labelled "Ask the family assistant" and a "Send" button
    And I see suggestion chips such as "What's on the calendar this week?"
    And capability pills show Calendar, Inbox, Wiki, Signal (green when available)

  Scenario: Assistant updates the calendar
    Given auth status has googleLinked true and geminiConfigured true
    When I send "Add dentist next Tuesday at 3pm"
    Then the reply shows an action chip starting with "Added"
    And the event appears on the Board calendar after refresh

  Scenario: Inbox drop-box and scan
    Given auth status has gmailReady true
    And auth status has geminiConfigured true
    When I open the AI tab
    Then I see an Inbox section and a "Scan inbox" control
    And I see a Todos section
    And the scan note reports todo(s) and calendar event(s)

  Scenario: Signal setup when not configured
    Given auth status has signalConfigured false
    When I open the AI tab
    Then the Signal panel mentions SIGNAL_API_URL, SIGNAL_NUMBER, and SIGNAL_ALLOWED_SENDERS

  Scenario: Signal registered
    Given GET /api/signal returns registered true
    When I open the AI tab
    Then the Signal panel shows the bot number, allowed family names, and "Listening: yes"

  # Knowledge base lives only in the private GitHub repo (not DATA_DIR).
  # Todos from email scans are local DATA_DIR/todos.json — not wiki content.
  # Default QA does not send email, create real calendar events, register Signal, or "Say hello".
