# Team Task App Requirements

This document defines the product requirements for the task management app used
to evaluate Lane.

The purpose of this app is not to demonstrate Lane-specific APIs first. The app
should represent the kind of team task management product where SWR or TanStack
Query would naturally be used. Lane can then be evaluated by replacing that
implementation while preserving, or improving, the same user experience with
React transitions.

## Goal

Build a lightweight team task management app that supports shared work across a
team.

The app should be realistic enough to exercise common client data requirements:
team-scoped data, shared reference data, filtered lists, detail views, mutations,
optimistic feedback, refresh, retry, permission errors, and user/team switching.

The app does not need strict production-grade authentication, authorization, or
collaboration semantics. Mock or lightweight implementations are acceptable as
long as the user-facing requirements are represented.

## Product Shape

The app is a team task workspace.

Users can sign in, choose a team, view team tasks, organize tasks by project and
label, assign work to teammates, update task status, and inspect task details.

The app should support at least these entities:

- User
- Team
- Team member
- Task
- Project
- Label

## Core User Requirements

### See Team Work

Users want to understand what the team is working on.

- View a list of tasks for the current team.
- See task title, status, assignee, project, labels, priority, and due date when
  available.
- Distinguish tasks assigned to the current user from tasks assigned to others.
- Refresh the view when the user wants to see the latest state.
- Keep existing visible task information on screen while refreshed data is being
  loaded when possible.

### Manage My Work

Users want to quickly find and process the tasks that matter to them.

- Filter tasks to "assigned to me".
- Filter tasks by status, project, label, due date, and priority.
- Search tasks by keyword.
- Open a task from a filtered list and keep the surrounding list context.
- Complete, reopen, or change status without losing the current view.

### Create Tasks

Users want to capture new work quickly.

- Create a task with a title.
- Optionally add description, assignee, project, labels, priority, and due date.
- See immediate feedback after submitting a new task.
- Preserve useful context if creation fails.
- Make the created task visible in relevant lists after the server confirms it.

### Edit Task Details

Users want to update task information from a detail view.

- Open a task detail panel or page from the task list.
- Edit title, description, status, assignee, project, labels, priority, and due
  date.
- See saving or pending feedback for edits.
- Reflect confirmed edits in both the detail view and any visible task lists.
- Handle failed edits without making the whole app feel broken.

### Assign Work

Users want to assign tasks to teammates.

- Search or browse team members as assignee candidates.
- Assign or unassign a task.
- See assignee changes reflected anywhere the task appears.
- Handle stale or missing member data gracefully.

### Organize Work

Users want to structure team tasks with projects and labels.

- View available projects and labels for the current team.
- Add or remove labels from a task.
- Move a task between projects.
- Create a label while editing a task if the desired label does not exist.
- Make newly created labels available in other label pickers after confirmation.
- Keep local draft input isolated from unrelated consumers.

### Switch Context

Users may belong to more than one team.

- Sign in as a user.
- See the current user and their available teams.
- Switch between teams.
- Ensure tasks, projects, labels, and members are scoped to the selected team.
- Avoid showing stale data from the previous team after switching.
- Clear user-scoped data after sign out.

### Respect Permissions

Users may have different roles in a team.

- Allow normal members to view and update ordinary tasks.
- Restrict team administration actions to admins.
- Represent permission errors in the UI when a user attempts an unavailable
  action.
- Avoid treating permission failures as generic network failures.

Strict permission modeling is not required. The app only needs enough role
behavior to exercise permission-aware data flows.

### Recover From Delay And Failure

Users should be able to keep working when the network is slow or an operation
fails.

- Show pending feedback for slow reads and writes.
- Keep useful previous information visible during background refresh where
  appropriate.
- Show scoped error states near the affected workflow.
- Allow retry for failed reads.
- Preserve important user input when a mutation fails.
- Handle session expiration or auth-like failures without collapsing unrelated
  parts of the app.

### Keep Shared Data Consistent

Users expect the same task, label, project, or member to look consistent across
the app.

- If a task is updated in detail, visible lists should converge on the updated
  state.
- If a label is created in one picker, other label consumers should be able to
  observe it after refresh.
- If a team member changes, assignee pickers and task metadata should refresh
  coherently.
- Local drafts and optimistic-only state should not leak globally unless the app
  intentionally promotes them.

## Views

The app should include enough surface area to exercise the requirements.

Minimum useful views:

- Sign-in or user switcher view.
- Team switcher.
- Task list view.
- Task detail panel or page.
- Task creation flow.
- Project and label selectors.
- Assignee selector.
- Basic team settings or member list view.

Optional views:

- Board view grouped by status.
- "My tasks" view.
- Upcoming or due-soon view.
- Completed tasks view.

## Acceptance Scenarios

These scenarios should pass in both the baseline implementation and the Lane
replacement implementation.

- A user signs in, chooses a team, and sees that team's task list.
- A user switches teams and no longer sees tasks, labels, projects, or members
  from the previous team.
- A user filters tasks by assignee, status, project, label, and keyword.
- A user opens a task detail view from a filtered list and returns without losing
  the list context.
- A user creates a task and sees it appear in the relevant task list after the
  operation succeeds.
- A user edits a task title or status and sees the change reflected in both the
  detail view and the list.
- A user assigns a task to a teammate through an assignee picker.
- A user creates a new label from a task detail flow and later sees that label
  in another label picker.
- A user refreshes task data while keeping the existing list usable where
  possible.
- A user encounters a failed read and can retry.
- A user encounters a failed write and sees the error near the attempted action.
- A user signs out and user-scoped or team-scoped data is cleared from the UI.
- A non-admin user attempts an admin-only action and sees a permission-aware
  response.

## Baseline And Replacement Strategy

The first implementation should be written with SWR or TanStack Query in the
style that would be natural for that library.

That implementation becomes the baseline for behavior and user experience. Lane
should then replace the data layer while keeping the same product requirements.

Lane does not need to copy the exact API shape or internal behavior of the
baseline library. The replacement is successful when the app can deliver the
same or better user experience, especially around transitions, pending states,
and preserving useful UI during async work.

## Out Of Scope For The First Evaluation App

- Real production authentication.
- Strict multi-tenant security.
- Real-time collaboration or WebSocket updates.
- Complex conflict resolution.
- Offline support.
- Notifications.
- Audit logs.
- Advanced role and permission management.

These can be revisited later if they become useful for evaluating Lane.
