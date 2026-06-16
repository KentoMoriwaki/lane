/**
 * @generated SignedSource<<c515eccaea98a47985cc352b4586eaa3>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type sidebarUser_viewer$data = {
  readonly color: string;
  readonly email: string;
  readonly initials: string;
  readonly name: string;
  readonly " $fragmentType": "sidebarUser_viewer";
};
export type sidebarUser_viewer$key = {
  readonly " $data"?: sidebarUser_viewer$data;
  readonly " $fragmentSpreads": FragmentRefs<"sidebarUser_viewer">;
};

const node: ReaderFragment = {
  "argumentDefinitions": [],
  "kind": "Fragment",
  "metadata": null,
  "name": "sidebarUser_viewer",
  "selections": [
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
      "name": "email",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "initials",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "color",
      "storageKey": null
    }
  ],
  "type": "Viewer",
  "abstractKey": null
};

(node as any).hash = "1992749fffecffc7461edb46c97f3689";

export default node;
