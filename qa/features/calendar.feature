Feature: Calendar column
  As a family member
  I want the calendar column to reflect Google link state
  So I know today’s schedule or how to connect

  Background:
    Given the board server is running at BASE_URL
    And I have fetched GET "/api/auth/status"
    And I open "/"

  Scenario: Calendar chrome is present
    Then I see calendar chrome labeled "Calendar" or "Today"

  Scenario: Linked Google shows events or empty state
    Given auth status has googleLinked true
    Then I see an events list or empty-state copy containing "No events"
    And I am not stuck on "Link Google" only

  Scenario: Unlinked Google shows setup
    Given auth status has googleLinked false
    Then I see setup or "Link Google" copy
