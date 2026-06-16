/**
 * @generated SignedSource<<01873a709d1afac3dfeca930f07028f7>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type TaskPriority = "high" | "low" | "medium" | "none" | "urgent";
export type TaskStatus = "backlog" | "canceled" | "done" | "in_progress" | "in_review" | "todo";
export type UpdateTaskInput = {
  assigneeId?: string | null | undefined;
  description?: string | null | undefined;
  dueDate?: string | null | undefined;
  priority?: TaskPriority | null | undefined;
  projectId?: string | null | undefined;
  status?: TaskStatus | null | undefined;
  title?: string | null | undefined;
};
export type mutationsUpdateTaskMutation$variables = {
  id: string;
  input: UpdateTaskInput;
};
export type mutationsUpdateTaskMutation$data = {
  readonly updateTask: {
    readonly id: string;
    readonly " $fragmentSpreads": FragmentRefs<"taskDetailPanel_task" | "taskRow_task">;
  };
};
export type mutationsUpdateTaskMutation = {
  response: mutationsUpdateTaskMutation$data;
  variables: mutationsUpdateTaskMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "id"
  },
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "input"
  }
],
v1 = [
  {
    "kind": "Variable",
    "name": "id",
    "variableName": "id"
  },
  {
    "kind": "Variable",
    "name": "input",
    "variableName": "input"
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
  "name": "name",
  "storageKey": null
},
v4 = {
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
    "name": "mutationsUpdateTaskMutation",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "Task",
        "kind": "LinkedField",
        "name": "updateTask",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          {
            "args": null,
            "kind": "FragmentSpread",
            "name": "taskRow_task"
          },
          {
            "args": null,
            "kind": "FragmentSpread",
            "name": "taskDetailPanel_task"
          }
        ],
        "storageKey": null
      }
    ],
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "mutationsUpdateTaskMutation",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "Task",
        "kind": "LinkedField",
        "name": "updateTask",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
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
            "name": "priority",
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
              (v3/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "initials",
                "storageKey": null
              },
              (v4/*:: as any*/)
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
              (v4/*:: as any*/),
              (v3/*:: as any*/)
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
              (v3/*:: as any*/),
              (v4/*:: as any*/)
            ],
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "description",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "updatedAt",
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "f991c82b0d6be9a191e4ddec57a18576",
    "id": null,
    "metadata": {},
    "name": "mutationsUpdateTaskMutation",
    "operationKind": "mutation",
    "text": "mutation mutationsUpdateTaskMutation(\n  $id: ID!\n  $input: UpdateTaskInput!\n) {\n  updateTask(id: $id, input: $input) {\n    id\n    ...taskRow_task\n    ...taskDetailPanel_task\n  }\n}\n\nfragment taskDetailPanel_task on Task {\n  id\n  title\n  description\n  status\n  priority\n  dueDate\n  updatedAt\n  assignee {\n    id\n    name\n    initials\n    color\n  }\n  project {\n    id\n    name\n    color\n  }\n  labels {\n    id\n    name\n    color\n  }\n}\n\nfragment taskRow_task on Task {\n  id\n  title\n  status\n  priority\n  dueDate\n  assignee {\n    id\n    name\n    initials\n    color\n  }\n  project {\n    id\n    key\n    color\n  }\n  labels {\n    id\n    name\n    color\n  }\n}\n"
  }
};
})();

(node as any).hash = "64129ce6283cfa18af40ff60e362ecb3";

export default node;
