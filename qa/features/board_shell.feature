Feature: Board shell and access gate
  As a family member
  I want the board to load (or unlock cleanly)
  So I can see the dashboard

  Background:
    Given the board server is running at BASE_URL
    And I have fetched GET "/api/auth/status"

  Scenario: Board loads when the gate is disabled
    Given BOARD_ACCESS_CODE and BOARD_ACCESS_SECRET are not both set
    When I open "/"
    Then I am not redirected to "/unlock"
    And the board shell is visible

  Scenario: Unlock page when the gate is enabled
    Given BOARD_ACCESS_CODE and BOARD_ACCESS_SECRET are both set
    And I do not have a valid fb_gate cookie
    When I open "/"
    Then I am redirected to "/unlock"
    And I see the heading "Unlock Family Board"
    And I see the access code field "#code"

  Scenario: Board loads after unlock
    Given BOARD_ACCESS_CODE and BOARD_ACCESS_SECRET are both set
    When I unlock via POST "/api/unlock" with a valid code
    And I open "/"
    Then the board shell is visible
