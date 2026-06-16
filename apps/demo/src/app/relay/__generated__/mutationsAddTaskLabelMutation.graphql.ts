/**
 * @generated SignedSource<<69d833057ca8297c3d72469a843d5f9e>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type mutationsAddTaskLabelMutation$variables = {
  labelId: string;
  taskId: string;
};
export type mutationsAddTaskLabelMutation$data = {
  readonly addTaskLabel: {
    readonly id: string;
    readonly " $fragmentSpreads": FragmentRefs<"taskDetailPanel_task" | "taskRow_task">;
  };
};
export type mutationsAddTaskLabelMutation = {
  response: mutationsAddTaskLabelMutation$data;
  variables: mutationsAddTaskLabelMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "labelId"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "taskId"
},
v2 = [
  {
    "kind": "Variable",
    "name": "labelId",
    "variableName": "labelId"
  },
  {
    "kind": "Variable",
    "name": "taskId",
    "variableName": "taskId"
  }
],
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
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
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "mutationsAddTaskLabelMutation",
    "selections": [
      {
        "alias": null,
        "args": (v2/*:: as any*/),
        "concreteType": "Task",
        "kind": "LinkedField",
        "name": "addTaskLabel",
        "plural": false,
        "selections": [
          (v3/*:: as any*/),
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
    "argumentDefinitions": [
      (v1/*:: as any*/),
      (v0/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "mutationsAddTaskLabelMutation",
    "selections": [
      {
        "alias": null,
        "args": (v2/*:: as any*/),
        "concreteType": "Task",
        "kind": "LinkedField",
        "name": "addTaskLabel",
        "plural": false,
        "selections": [
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
              (v3/*:: as any*/),
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
              (v3/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "key",
                "storageKey": null
              },
              (v5/*:: as any*/),
              (v4/*:: as any*/)
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
              (v3/*:: as any*/),
              (v4/*:: as any*/),
              (v5/*:: as any*/)
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
    "cacheID": "f14a6c3a8292ba88c068f09ad7caa23c",
    "id": null,
    "metadata": {},
    "name": "mutationsAddTaskLabelMutation",
    "operationKind": "mutation",
    "text": "mutation mutationsAddTaskLabelMutation(\n  $taskId: ID!\n  $labelId: ID!\n) {\n  addTaskLabel(taskId: $taskId, labelId: $labelId) {\n    id\n    ...taskRow_task\n    ...taskDetailPanel_task\n  }\n}\n\nfragment taskDetailPanel_task on Task {\n  id\n  title\n  description\n  status\n  priority\n  dueDate\n  updatedAt\n  assignee {\n    id\n    name\n    initials\n    color\n  }\n  project {\n    id\n    name\n    color\n  }\n  labels {\n    id\n    name\n    color\n  }\n}\n\nfragment taskRow_task on Task {\n  id\n  title\n  status\n  priority\n  dueDate\n  assignee {\n    id\n    name\n    initials\n    color\n  }\n  project {\n    id\n    key\n    color\n  }\n  labels {\n    id\n    name\n    color\n  }\n}\n"
  }
};
})();

(node as any).hash = "3cc8021924f724cd29b86daffb259464";

export default node;
