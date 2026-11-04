// Configuration for React 19's obsolete API surface. These are supported ESLint
// core rules, not a custom rule, adapter, patched dependency or vendored source.
const obsolete = {
  React: [
    "renderComponent", "renderComponentToString", "renderComponentToStaticMarkup",
    "isValidComponent", "isValidClass", "render", "unmountComponentAtNode",
    "findDOMNode", "renderToString", "renderToStaticMarkup", "createClass", "PropTypes", "DOM",
  ],
  ReactPerf: ["printDOM", "getMeasurementsSummaryMap"],
  Perf: ["printDOM", "getMeasurementsSummaryMap"],
  ReactDOM: ["render", "hydrate", "unmountComponentAtNode"],
  ReactDOMServer: ["renderToNodeStream"],
};
const modules = {
  react: "React",
  "react-addons-perf": "ReactPerf",
  "react-dom": "ReactDOM",
  "react-dom/server": "ReactDOMServer",
};
const message = "Deprecated React API; use the supported React 19 API.";
const selectors = Object.entries(modules).flatMap(([module, object]) =>
  obsolete[object].flatMap(property => [
    { selector: `ImportDeclaration[source.value="${module}"] > ImportSpecifier[imported.name="${property}"]`, message },
    { selector: `VariableDeclarator[init.callee.name="require"][init.arguments.0.value="${module}"] > ObjectPattern > Property[key.name="${property}"]`, message },
  ]),
);
for (const property of ["classSet", "cloneWithProps", "LinkedStateMixin", "TestUtils"]) {
  selectors.push({ selector: `MemberExpression[object.object.name="React"][object.property.name="addons"][property.name="${property}"]`, message });
}
selectors.push(
  { selector: 'MemberExpression[object.type="ThisExpression"][property.name="transferPropsTo"]', message },
  // Reserve obsolete lifecycle names for every class/object method. This also
  // covers components recognized only through JSDoc, fields or factory syntax.
  { selector: 'MethodDefinition[key.name=/^componentWill(Mount|ReceiveProps|Update)$/], Property[key.name=/^componentWill(Mount|ReceiveProps|Update)$/][value.type=/^(FunctionExpression|ArrowFunctionExpression)$/], PropertyDefinition[key.name=/^componentWill(Mount|ReceiveProps|Update)$/][value.type=/^(FunctionExpression|ArrowFunctionExpression)$/]', message: "Deprecated lifecycle name; use the supported React lifecycle API." },
);

export const reactDeprecationRules = {
  "no-restricted-properties": ["error", ...Object.entries(obsolete).flatMap(([object, properties]) =>
    properties.map(property => ({ object, property, message })))],
  "no-restricted-syntax": ["error", ...selectors],
};
