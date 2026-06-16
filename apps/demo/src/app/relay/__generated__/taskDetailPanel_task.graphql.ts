/**
 * @generated SignedSource<<64fa90ac431ba8af54f138232b672512>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
export type TaskPriority = "high" | "low" | "medium" | "none" | "urgent";
export type TaskStatus = "backlog" | "canceled" | "done" | "in_progress" | "in_review" | "todo";
import { FragmentRefs } from "relay-runtime";
export type taskDetailPanel_task$data = {
  readonly assignee: {
    readonly color: string;
    readonly id: string;
    readonly initials: string;
    readonly name: string;
  } | null | undefined;
  readonly description: string;
  readonly dueDate: string | null | undefined;
  readonly id: string;
  readonly labels: ReadonlyArray<{
    readonly color: string;
    readonly id: string;
    readonly name: string;
  }>;
  readonly priority: TaskPriority;
  readonly project: {
    readonly color: string;
    readonly id: string;
    readonly name: string;
  } | null | undefined;
  readonly status: TaskStatus;
  readonly title: string;
  readonly updatedAt: string;
  readonly " $fragmentType": "taskDetailPanel_task";
};
export type taskDetailPanel_task$key = {
  readonly " $data"?: taskDetailPanel_task$data;
  readonly " $fragmentSpreads": FragmentRefs<"taskDetailPanel_task">;
};

const node: ReaderFragment = (function(){
var v0 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "color",
  "storageKey": null
},
v3 = [
  (v0/*:: as any*/),
  (v1/*:: as any*/),
  (v2/*:: as any*/)
];
return {
  "argumentDefinitions": [],
  "kind": "Fragment",
  "metadata": null,
  "name": "taskDetailPanel_task",
  "selections": [
    (v0/*:: as any*/),
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
      "name": "description",
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
        (v0/*:: as any*/),
        (v1/*:: as any*/),
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "initials",
          "storageKey": null
        },
        (v2/*:: as any*/)
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
      "selections": (v3/*:: as any*/),
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "concreteType": "Label",
      "kind": "LinkedField",
      "name": "labels",
      "plural": true,
      "selections": (v3/*:: as any*/),
      "storageKey": null
    }
  ],
  "type": "Task",
  "abstractKey": null
};
})();

(node as any).hash = "9dd46c59ee06b604526892e6144b3cee";

export default node;
