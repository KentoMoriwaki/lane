/**
 * @generated SignedSource<<909af78dc3d74b40f4e9b4e47f6bf35a>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type DueFilter = "overdue" | "today" | "week";
export type TaskPriority = "high" | "low" | "medium" | "none" | "urgent";
export type TaskScope = "all" | "mine" | "unassigned";
export type TaskStatus = "backlog" | "canceled" | "done" | "in_progress" | "in_review" | "todo";
export type TaskFilterInput = {
  due?: DueFilter | null | undefined;
  labelId?: string | null | undefined;
  priority?: ReadonlyArray<TaskPriority> | null | undefined;
  projectId?: string | null | undefined;
  q?: string | null | undefined;
  scope?: TaskScope | null | undefined;
  status?: ReadonlyArray<TaskStatus> | null | undefined;
};
export type RelayTasksQuery$variables = {
  filters?: TaskFilterInput | null | undefined;
};
export type RelayTasksQuery$data = {
  readonly tasks: ReadonlyArray<{
    readonly id: string;
    readonly priority: TaskPriority;
    readonly " $fragmentSpreads": FragmentRefs<"taskRow_task">;
  }>;
};
export type RelayTasksQuery = {
  response: RelayTasksQuery$data;
  variables: RelayTasksQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "filters"
  }
],
v1 = [
  {
    "kind": "Variable",
    "name": "filters",
    "variableName": "filters"
  }
],
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "priority",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "color",
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "RelayTasksQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "Task",
        "kind": "LinkedField",
        "name": "tasks",
        "plural": true,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          {
            "args": null,
            "kind": "FragmentSpread",
            "name": "taskRow_task"
          }
        ],
        "storageKey": null
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "RelayTasksQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "Task",
        "kind": "LinkedField",
        "name": "tasks",
        "plural": true,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "title",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "status",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "dueDate",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "TeamMember",
            "kind": "LinkedField",
            "name": "assignee",
            "plural": false,
            "selections": [
              (v2/*:: as any*/),
              (v4/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "initials",
                "storageKey": null
              },
              (v5/*:: as any*/)
            ],
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "Project",
            "kind": "LinkedField",
            "name": "project",
            "plural": false,
            "selections": [
              (v2/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "key",
                "storageKey": null
              },
              (v5/*:: as any*/)
            ],
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "Label",
            "kind": "LinkedField",
            "name": "labels",
            "plural": true,
            "selections": [
              (v2/*:: as any*/),
              (v4/*:: as any*/),
              (v5/*:: as any*/)
            ],
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "c1856973a1cd88c96059f87e0af79c92",
    "id": null,
    "metadata": {},
    "name": "RelayTasksQuery",
    "operationKind": "query",
    "text": "query RelayTasksQuery(\n  $filters: TaskFilterInput\n) {\n  tasks(filters: $filters) {\n    id\n    priority\n    ...taskRow_task\n  }\n}\n\nfragment taskRow_task on Task {\n  id\n  title\n  status\n  priority\n  dueDate\n  assignee {\n    id\n    name\n    initials\n    color\n  }\n  project {\n    id\n    key\n    color\n  }\n  labels {\n    id\n    name\n    color\n  }\n}\n"
  }
};
})();

(node as any).hash = "5c88c579086237cdc3405828cc5d123f";

export default node;
