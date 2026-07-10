Feature: Right-column widgets
  As a family member
  I want each widget to match configuration from auth status
  So the board never looks broken or contradictory

  Background:
    Given the board server is running at BASE_URL
    And I have fetched GET "/api/auth/status"
    And I open "/"
    # Each widget: <h2> title visible, or Expand/Collapse control present

  Scenario: Clock widget renders
    Then the "Clock" widget section is present

  Scenario Outline: Configured widgets show live or empty UI
    Given auth status has <flag> true
    Then the "<title>" widget shows live UI or an empty-data state
    And it does not show only setup/link copy for that integration

    Examples:
      | title   | flag               |
      | Weather | weatherConfigured  |
      | Catlink | catlinkLinked      |
      | Spotify | spotifyLinked      |
      | Hue     | hueReady           |

  Scenario Outline: Unconfigured widgets show setup
    Given auth status has <flag> false
    Then the "<title>" widget shows setup or link/pair copy

    Examples:
      | title   | flag               |
      | Weather | weatherConfigured  |
      | Catlink | catlinkLinked      |
      | Spotify | spotifyLinked      |
      | Hue     | hueReady           |

  Scenario: Indoor when Nest is ready
    Given auth status has nestConfigured true
    And auth status has googleLinked true
    Then the "Indoor" widget shows climate UI or an empty-data state

  Scenario: Indoor when Nest is not ready
    Given auth status has nestConfigured false or googleLinked false
    Then the "Indoor" widget shows Link Google or Nest setup copy

  # Default QA does NOT cover:
  # - Control POSTs (/api/*/control, Hue toggles, Spotify transport, CatLink Clean/…)
  # - Visual regression / screenshots
  # - Full OAuth link flows (unless the user asks)
