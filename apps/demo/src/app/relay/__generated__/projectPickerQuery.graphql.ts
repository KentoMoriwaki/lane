/**
 * @generated SignedSource<<8e5f8ada8774fde72d97a10771108250>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type projectPickerQuery$variables = Record<PropertyKey, never>;
export type projectPickerQuery$data = {
  readonly projects: ReadonlyArray<{
    readonly color: string;
    readonly id: string;
    readonly name: string;
    readonly taskCount: number;
  }>;
};
export type projectPickerQuery = {
  response: projectPickerQuery$data;
  variables: projectPickerQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "Project",
    "kind": "LinkedField",
    "name": "projects",
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
        "name": "color",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "taskCount",
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
    "name": "projectPickerQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "projectPickerQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "042e60db0b8ec41a6733136fcf568291",
    "id": null,
    "metadata": {},
    "name": "projectPickerQuery",
    "operationKind": "query",
    "text": "query projectPickerQuery {\n  projects {\n    id\n    name\n    color\n    taskCount\n  }\n}\n"
  }
};
})();

(node as any).hash = "5965cc7c3288cb9dc423acb6e396a3a4";

export default node;
