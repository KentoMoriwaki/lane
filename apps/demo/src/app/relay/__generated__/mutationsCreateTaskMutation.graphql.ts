/**
 * @generated SignedSource<<bfd0c759a8cba326d3d3459e56294531>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type TaskPriority = "high" | "low" | "medium" | "none" | "urgent";
export type TaskStatus = "backlog" | "canceled" | "done" | "in_progress" | "in_review" | "todo";
export type CreateTaskInput = {
  assigneeId?: string | null | undefined;
  description?: string | null | undefined;
  dueDate?: string | null | undefined;
  labelIds?: ReadonlyArray<string> | null | undefined;
  priority?: TaskPriority | null | undefined;
  projectId?: string | null | undefined;
  status?: TaskStatus | null | undefined;
  title: string;
};
export type mutationsCreateTaskMutation$variables = {
  input: CreateTaskInput;
};
export type mutationsCreateTaskMutation$data = {
  readonly createTask: {
    readonly id: string;
    readonly " $fragmentSpreads": FragmentRefs<"taskDetailPanel_task" | "taskRow_task">;
  };
};
export type mutationsCreateTaskMutation = {
  response: mutationsCreateTaskMutation$data;
  variables: mutationsCreateTaskMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "input"
  }
],
v1 = [
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
    "name": "mutationsCreateTaskMutation",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "Task",
        "kind": "LinkedField",
        "name": "createTask",
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
    "name": "mutationsCreateTaskMutation",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "Task",
        "kind": "LinkedField",
        "name": "createTask",
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
    "cacheID": "dee4760383e9370f4cab822d921506a9",
    "id": null,
    "metadata": {},
    "name": "mutationsCreateTaskMutation",
    "operationKind": "mutation",
    "text": "mutation mutationsCreateTaskMutation(\n  $input: CreateTaskInput!\n) {\n  createTask(input: $input) {\n    id\n    ...taskRow_task\n    ...taskDetailPanel_task\n  }\n}\n\nfragment taskDetailPanel_task on Task {\n  id\n  title\n  description\n  status\n  priority\n  dueDate\n  updatedAt\n  assignee {\n    id\n    name\n    initials\n    color\n  }\n  project {\n    id\n    name\n    color\n  }\n  labels {\n    id\n    name\n    color\n  }\n}\n\nfragment taskRow_task on Task {\n  id\n  title\n  status\n  priority\n  dueDate\n  assignee {\n    id\n    name\n    initials\n    color\n  }\n  project {\n    id\n    key\n    color\n  }\n  labels {\n    id\n    name\n    color\n  }\n}\n"
  }
};
})();

(node as any).hash = "7daaa2d44df2cf049af12088726a00ae";

export default node;
