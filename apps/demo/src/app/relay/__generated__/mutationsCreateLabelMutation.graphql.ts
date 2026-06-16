/**
 * @generated SignedSource<<5b1f321e1ee8d75fc41192de519c854d>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type CreateLabelInput = {
  color?: string | null | undefined;
  name: string;
};
export type mutationsCreateLabelMutation$variables = {
  input: CreateLabelInput;
};
export type mutationsCreateLabelMutation$data = {
  readonly createLabel: {
    readonly color: string;
    readonly id: string;
    readonly name: string;
  };
};
export type mutationsCreateLabelMutation = {
  response: mutationsCreateLabelMutation$data;
  variables: mutationsCreateLabelMutation$variables;
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
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "input",
        "variableName": "input"
      }
    ],
    "concreteType": "Label",
    "kind": "LinkedField",
    "name": "createLabel",
    "plural": false,
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
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "mutationsCreateLabelMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "mutationsCreateLabelMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "a3ed5c4a2e6775561c11c01f70122c5f",
    "id": null,
    "metadata": {},
    "name": "mutationsCreateLabelMutation",
    "operationKind": "mutation",
    "text": "mutation mutationsCreateLabelMutation(\n  $input: CreateLabelInput!\n) {\n  createLabel(input: $input) {\n    id\n    name\n    color\n  }\n}\n"
  }
};
})();

(node as any).hash = "ba8adb63871698c4571c8d39fca7bc77";

export default node;
