import { createContext, useContext, useRef, type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import {
  NavigationContainer,
  createNavigatorFactory,
  TabRouter,
  useNavigationBuilder,
  useIsFocused,
  type NavigationContainerRefWithCurrent,
} from "@react-navigation/native";
import { workspaceRoutes, type WorkspaceParams, type WorkspaceRoute } from "./mobile-navigation";

const WorkspaceContent = createContext<(route: WorkspaceRoute, focused: boolean) => ReactNode>(() => null);

// Stable screen identity: changing API data, theme or tokens must not replace inputs.
function WorkspaceScreen({ route }: { route: { name: WorkspaceRoute } }) {
  const render = useContext(WorkspaceContent);
  const focused = useIsFocused();
  const retained = useRef<{ focused: boolean; content: ReactNode } | null>(null);
  // Notify a workspace when it blurs, then leave its tree alone until focus.
  // Root form keystrokes and status polling need not rerender every hidden form.
  if (!retained.current || focused || retained.current.focused !== focused) {
    retained.current = { focused, content: render(route.name, focused) };
  }
  return retained.current.content;
}

function RetainedNavigator({ children }: { children: ReactNode }) {
  const { state, descriptors, render } = useNavigationBuilder(TabRouter, {
    children,
    initialRouteName: "home",
    backBehavior: "history",
  });
  const visited = useRef(new Set<string>());
  visited.current.add(state.routes[state.index].key);
  return render(<View style={styles.container}>
    {state.routes.map((route, index) => {
      if (!visited.current.has(route.key)) return null;
      const focused = index === state.index;
      return <View key={route.key} style={[StyleSheet.absoluteFillObject, { opacity: focused ? 1 : 0, zIndex: focused ? 1 : 0 }]}
        pointerEvents={focused ? "auto" : "none"}
        accessibilityElementsHidden={!focused}
        importantForAccessibility={focused ? "auto" : "no-hide-descendants"}>
        {descriptors[route.key].render()}
      </View>;
    })}
  </View>);
}
const Workspace = createNavigatorFactory(RetainedNavigator)();

/** One lazily mounted view per fixed workspace, retained only for this login. */
export function RetainedNavigation({ navigation, onRouteChange, render }: {
  navigation: NavigationContainerRefWithCurrent<WorkspaceParams>;
  onRouteChange: (route: WorkspaceRoute) => void;
  render: (route: WorkspaceRoute, focused: boolean) => ReactNode;
}) {
  const changed = () => {
    const route = navigation.getCurrentRoute()?.name as WorkspaceRoute | undefined;
    if (route) onRouteChange(route);
  };
  return <WorkspaceContent.Provider value={render}>
    <NavigationContainer ref={navigation} onReady={changed} onStateChange={changed}>
      <Workspace.Navigator>
        {workspaceRoutes.map(name => <Workspace.Screen key={name} name={name} component={WorkspaceScreen} />)}
      </Workspace.Navigator>
    </NavigationContainer>
  </WorkspaceContent.Provider>;
}
const styles = StyleSheet.create({ container: { flex: 1 } });
