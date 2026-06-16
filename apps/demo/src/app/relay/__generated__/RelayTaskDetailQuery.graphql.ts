/**
 * @generated SignedSource<<e18985dcf9232f5223cfd05aa5cabfdc>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type RelayTaskDetailQuery$variables = {
  id: string;
};
export type RelayTaskDetailQuery$data = {
  readonly task: {
    readonly id: string;
    readonly " $fragmentSpreads": FragmentRefs<"dependencyStatus_task" | "taskDetailPanel_task">;
  } | null | undefined;
};
export type RelayTaskDetailQuery = {
  response: RelayTaskDetailQuery$data;
  variables: RelayTaskDetailQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "id"
  }
],
v1 = [
  {
    "kind": "Variable",
    "name": "id",
    "variableName": "id"
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
  "name": "title",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "status",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "color",
  "storageKey": null
},
v7 = [
  (v2/*:: as any*/),
  (v5/*:: as any*/),
  (v6/*:: as any*/)
],
v8 = [
  (v2/*:: as any*/),
  (v3/*:: as any*/),
  (v4/*:: as any*/)
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "RelayTaskDetailQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "Task",
        "kind": "LinkedField",
        "name": "task",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          {
            "args": null,
            "kind": "FragmentSpread",
            "name": "taskDetailPanel_task"
          },
          {
            "kind": "Defer",
            "selections": [
              {
                "args": null,
                "kind": "FragmentSpread",
                "name": "dependencyStatus_task"
              }
            ]
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
    "name": "RelayTaskDetailQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "Task",
        "kind": "LinkedField",
        "name": "task",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "description",
            "storageKey": null
          },
          (v4/*:: as any*/),
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
            "kind": "ScalarField",
            "name": "updatedAt",
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
              (v5/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "initials",
                "storageKey": null
              },
              (v6/*:: as any*/)
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
            "selections": (v7/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "Label",
            "kind": "LinkedField",
            "name": "labels",
            "plural": true,
            "selections": (v7/*:: as any*/),
            "storageKey": null
          },
          {
            "if": null,
            "kind": "Defer",
            "label": "RelayTaskDetailQuery$defer$dependencyStatus_task",
            "selections": [
              {
                "alias": null,
                "args": null,
                "concreteType": "Task",
                "kind": "LinkedField",
                "name": "blockedBy",
                "plural": true,
                "selections": (v8/*:: as any*/),
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "concreteType": "Task",
                "kind": "LinkedField",
                "name": "blocks",
                "plural": true,
                "selections": (v8/*:: as any*/),
                "storageKey": null
              }
            ]
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "20b8c4aac785e4cea17d79ae91fa0023",
    "id": null,
    "metadata": {},
    "name": "RelayTaskDetailQuery",
    "operationKind": "query",
    "text": "query RelayTaskDetailQuery(\n  $id: ID!\n) {\n  task(id: $id) {\n    id\n    ...taskDetailPanel_task\n    ...dependencyStatus_task @defer(label: \"RelayTaskDetailQuery$defer$dependencyStatus_task\")\n  }\n}\n\nfragment dependencyStatus_task on Task {\n  blockedBy {\n    id\n    title\n    status\n  }\n  blocks {\n    id\n    title\n    status\n  }\n}\n\nfragment taskDetailPanel_task on Task {\n  id\n  title\n  description\n  status\n  priority\n  dueDate\n  updatedAt\n  assignee {\n    id\n    name\n    initials\n    color\n  }\n  project {\n    id\n    name\n    color\n  }\n  labels {\n    id\n    name\n    color\n  }\n}\n"
  }
};
})();

(node as any).hash = "03c8c26fab5ea9d1b06c2d29e3ed28d7";

export default node;
