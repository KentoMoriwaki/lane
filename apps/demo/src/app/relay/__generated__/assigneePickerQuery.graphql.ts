/**
 * @generated SignedSource<<a7def8a7d252d6f9b83b5e1417f91450>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type MemberRole = "admin" | "member";
export type assigneePickerQuery$variables = Record<PropertyKey, never>;
export type assigneePickerQuery$data = {
  readonly members: ReadonlyArray<{
    readonly color: string;
    readonly email: string;
    readonly id: string;
    readonly initials: string;
    readonly name: string;
    readonly role: MemberRole;
  }>;
};
export type assigneePickerQuery = {
  response: assigneePickerQuery$data;
  variables: assigneePickerQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "TeamMember",
    "kind": "LinkedField",
    "name": "members",
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
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "role",
        "storageKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "assigneePickerQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "assigneePickerQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "2d3ff16964f0f6161c97a3e37eb3a030",
    "id": null,
    "metadata": {},
    "name": "assigneePickerQuery",
    "operationKind": "query",
    "text": "query assigneePickerQuery {\n  members {\n    id\n    name\n    email\n    initials\n    color\n    role\n  }\n}\n"
  }
};
})();

(node as any).hash = "f3e883c6df086bd8f060f7a4a06113bf";

export default node;
