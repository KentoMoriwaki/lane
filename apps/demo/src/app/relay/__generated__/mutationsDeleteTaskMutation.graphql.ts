/**
 * @generated SignedSource<<2720beec448743ecf390bb63484fac74>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type mutationsDeleteTaskMutation$variables = {
  id: string;
};
export type mutationsDeleteTaskMutation$data = {
  readonly deleteTask: {
    readonly deletedTaskId: string;
  };
};
export type mutationsDeleteTaskMutation = {
  response: mutationsDeleteTaskMutation$data;
  variables: mutationsDeleteTaskMutation$variables;
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
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "id",
        "variableName": "id"
      }
    ],
    "concreteType": "DeleteTaskPayload",
    "kind": "LinkedField",
    "name": "deleteTask",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "deletedTaskId",
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
    "name": "mutationsDeleteTaskMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "mutationsDeleteTaskMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "df730649665b6a65a6ab657cb8c32683",
    "id": null,
    "metadata": {},
    "name": "mutationsDeleteTaskMutation",
    "operationKind": "mutation",
    "text": "mutation mutationsDeleteTaskMutation(\n  $id: ID!\n) {\n  deleteTask(id: $id) {\n    deletedTaskId\n  }\n}\n"
  }
};
})();

(node as any).hash = "f5f2b849cea21d2d6e90dee06cc152e2";

export default node;
