/**
 * @generated SignedSource<<9c01c73e908f01a95d763a265f7480dd>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
export type TaskStatus = "backlog" | "canceled" | "done" | "in_progress" | "in_review" | "todo";
import { FragmentRefs } from "relay-runtime";
export type dependencyStatus_task$data = {
  readonly blockedBy: ReadonlyArray<{
    readonly id: string;
    readonly status: TaskStatus;
    readonly title: string;
  }>;
  readonly blocks: ReadonlyArray<{
    readonly id: string;
    readonly status: TaskStatus;
    readonly title: string;
  }>;
  readonly " $fragmentType": "dependencyStatus_task";
};
export type dependencyStatus_task$key = {
  readonly " $data"?: dependencyStatus_task$data;
  readonly " $fragmentSpreads": FragmentRefs<"dependencyStatus_task">;
};

const node: ReaderFragment = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "id",
    "storageKey": null
  },
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
  }
];
return {
  "argumentDefinitions": [],
  "kind": "Fragment",
  "metadata": null,
  "name": "dependencyStatus_task",
  "selections": [
    {
      "alias": null,
      "args": null,
      "concreteType": "Task",
      "kind": "LinkedField",
      "name": "blockedBy",
      "plural": true,
      "selections": (v0/*:: as any*/),
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "concreteType": "Task",
      "kind": "LinkedField",
      "name": "blocks",
      "plural": true,
      "selections": (v0/*:: as any*/),
      "storageKey": null
    }
  ],
  "type": "Task",
  "abstractKey": null
};
})();

(node as any).hash = "7fd056c2369525622e50143c7f9bfeaf";

export default node;
