/**
 * @generated SignedSource<<d3b1d7353e319dd243afed95322b3f37>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
export type TaskPriority = "high" | "low" | "medium" | "none" | "urgent";
export type TaskStatus = "backlog" | "canceled" | "done" | "in_progress" | "in_review" | "todo";
import { FragmentRefs } from "relay-runtime";
export type taskRow_task$data = {
  readonly assignee: {
    readonly color: string;
    readonly id: string;
    readonly initials: string;
    readonly name: string;
  } | null | undefined;
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
    readonly key: string;
  } | null | undefined;
  readonly status: TaskStatus;
  readonly title: string;
  readonly " $fragmentType": "taskRow_task";
};
export type taskRow_task$key = {
  readonly " $data"?: taskRow_task$data;
  readonly " $fragmentSpreads": FragmentRefs<"taskRow_task">;
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
};
return {
  "argumentDefinitions": [],
  "kind": "Fragment",
  "metadata": null,
  "name": "taskRow_task",
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
      "selections": [
        (v0/*:: as any*/),
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "key",
          "storageKey": null
        },
        (v2/*:: as any*/)
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
        (v0/*:: as any*/),
        (v1/*:: as any*/),
        (v2/*:: as any*/)
      ],
      "storageKey": null
    }
  ],
  "type": "Task",
  "abstractKey": null
};
})();

(node as any).hash = "85ad91e0101aa63b00b53290c39603bc";

export default node;
