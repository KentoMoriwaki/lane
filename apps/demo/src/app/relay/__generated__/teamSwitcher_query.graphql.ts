/**
 * @generated SignedSource<<8667ff2eb79380ff05347e5b94fc80b9>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
export type MemberRole = "admin" | "member";
import { FragmentRefs } from "relay-runtime";
export type teamSwitcher_query$data = {
  readonly teams: ReadonlyArray<{
    readonly id: string;
    readonly memberCount: number;
    readonly name: string;
    readonly role: MemberRole;
    readonly slug: string;
  }>;
  readonly " $fragmentType": "teamSwitcher_query";
};
export type teamSwitcher_query$key = {
  readonly " $data"?: teamSwitcher_query$data;
  readonly " $fragmentSpreads": FragmentRefs<"teamSwitcher_query">;
};

const node: ReaderFragment = {
  "argumentDefinitions": [],
  "kind": "Fragment",
  "metadata": null,
  "name": "teamSwitcher_query",
  "selections": [
    {
      "alias": null,
      "args": null,
      "concreteType": "TeamSummary",
      "kind": "LinkedField",
      "name": "teams",
      "plural": true,
      "selections": [
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
          "name": "name",
          "storageKey": null
        },
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "slug",
          "storageKey": null
        },
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "role",
          "storageKey": null
        },
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "memberCount",
          "storageKey": null
        }
      ],
      "storageKey": null
    }
  ],
  "type": "Query",
  "abstractKey": null
};

(node as any).hash = "11942f646f8362f4e8796093760fde29";

export default node;
