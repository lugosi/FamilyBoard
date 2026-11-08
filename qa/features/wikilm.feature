Feature: WikiLLM AI tab
  As a family member
  I want one assistant prompt that can update the calendar, plus an inbox drop-box, todos, and Slack
  So we can ask questions and turn messages and forwarded mail into calendar events

  Background:
    Given the board server is running at BASE_URL
    And I open "/"

  Scenario: Board and AI tabs exist
    Then I see main navigation with "Board" and "AI"
    When I select the "AI" tab
    Then I see Chat / Wiki controls on the AI tab

  Scenario: Assistant setup when Gemini is missing
    Given auth status has geminiConfigured false
    When I open the AI tab
    Then the assistant panel shows setup copy mentioning GEMINI_API_KEY

  Scenario: Single assistant prompt
    Given auth status has geminiConfigured true
    When I open the AI tab
    Then I see one prompt input labelled "Ask the family assistant" and a "Send" button
    And I see action chips such as "House dashboard" (only real actions, no fake example appointments)
    And Inbox / Slack / Todos live under Tools (not a second column on the chat)

  Scenario: House dashboard from chat or Slack
    Given auth status has geminiConfigured true
    When I send "House dashboard" (AI tab) or message the Slack bot the same
    Then the assistant calls house_dashboard and shows lights / litter / music / weather when linked
    And the reply includes tappable quick-action chips (web) or a "reply with one" action list (Slack)

  Scenario: Assistant updates the calendar
    Given auth status has googleLinked true and geminiConfigured true
    When I send "Add dentist next Tuesday at 3pm"
    Then the reply shows an action chip starting with "Added"
    And the event appears on the Board calendar after refresh

  Scenario: Inbox drop-box and scan
    Given auth status has gmailReady true
    And auth status has geminiConfigured true
    When I open the AI tab
    Then I open Tools and see an Inbox section and a "Scan" control
    And Tools mentions Todos live on wiki todos/list.md (or link the wiki)
    And the scan note reports todo(s) → wiki Todos and calendar event(s)

  Scenario: Slack setup when not configured
    Given auth status has slackConfigured false
    When I open the AI tab
    Then the Slack panel mentions SLACK_BOT_TOKEN and SLACK_APP_TOKEN

  Scenario: Slack connected
    Given GET /api/slack returns bot.connected true
    When I open the AI tab
    Then the Slack panel shows the workspace, the bot name, and "Connected: yes"

  Scenario: Wiki setup when GitHub is not configured
    Given auth status has wikilmGithubConfigured false
    When I open the AI tab and switch to "Wiki"
    Then the wiki view mentions WIKILM_GITHUB_TOKEN

  Scenario: Browse and search the wiki
    Given auth status has wikilmGithubConfigured true
    When I open the AI tab and switch to "Wiki"
    Then I see pages grouped by folder (People, House, Recipes, …; top-level pages under "Unfiled") with counts
    And opening a page shows its title, path, updated date, tags, summary, and rendered markdown
    And relative links between pages open inside the Wiki view
    When I type a search such as "guest password"
    Then matching pages show with a text snippet

  Scenario: Edit, create, move, delete in the Wiki view
    Given auth status has wikilmGithubConfigured true
    When I edit a page's markdown and Save
    Then I see "Saved." and the page's updated date is today
    And saving a page that changed elsewhere shows a conflict with "Reload latest" instead of overwriting
    When I create a page with "New" (folder, title, summary, tags, body)
    Then it opens and appears under its folder
    And Move and Delete (with confirmation) work and the list updates

  Scenario: Assistant remembers and looks things up
    Given auth status has wikilmGithubConfigured true and geminiConfigured true
    When I send "Remember that Maya's shoe size is 3"
    Then the reply shows action chips "Read wiki page" and "Updated “Sizes” in “Maya”"
    And only that section of the page changed
    When I send "What's the Wi-Fi password?"
    Then the reply cites the Wi-Fi page after "Searched the wiki" / "Read wiki page" chips

  # Knowledge base lives only in the private GitHub repo (not DATA_DIR). QA against a real repo
  # creates commits; prefer a scratch repo or the local mock (WIKILM_GITHUB_API_BASE_URL).
  # Todos live on wiki todos/list.md when the wiki is configured; otherwise DATA_DIR/todos.json.
  # Default QA does not send email, create real calendar events, or message Slack.
