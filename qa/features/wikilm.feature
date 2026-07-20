Feature: WikiLLM AI tab
  As a family member
  I want Board and AI tabs with a GitHub wiki, inbox drop-box, and todos
  So we can ask recipes and turn forwarded mail into actions

  Background:
    Given the board server is running at BASE_URL
    And I open "/"

  Scenario: Board and AI tabs exist
    Then I see main navigation with "Board" and "AI"
    When I select the "AI" tab
    Then I see the heading "WikiLLM"

  Scenario: Wiki setup when GitHub is not configured
    Given auth status has wikilmGithubConfigured false
    When I open the AI tab
    Then I see setup copy mentioning WIKILM_GITHUB_REPO or WIKILM_GITHUB_TOKEN

  Scenario: Chat setup when Gemini or wiki missing
    Given auth status has geminiConfigured false or wikilmGithubConfigured false
    When I open the AI tab
    Then chat shows setup for GEMINI_API_KEY and GitHub wiki env

  Scenario: Inbox drop-box and scan
    Given auth status has gmailReady true
    And auth status has geminiConfigured true
    When I open the AI tab
    Then I see an Inbox section and a "Scan inbox" control
    And I see a Todos section

  # Knowledge base lives only in the private GitHub repo (not DATA_DIR).
  # Todos from email scans are local DATA_DIR/todos.json — not wiki content.
  # Default QA does not send email or auto-commit without Save to wiki.
