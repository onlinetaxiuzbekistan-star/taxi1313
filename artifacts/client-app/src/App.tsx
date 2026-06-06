import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import Header from "@/components/Header";
import Home from "@/pages/Home";
import Search from "@/pages/Search";
import Book from "@/pages/Book";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import MyTrips from "@/pages/MyTrips";
import Profile from "@/pages/Profile";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/search" component={Search} />
      <Route path="/book" component={Book} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/my-trips" component={MyTrips} />
      <Route path="/profile" component={Profile} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <Header />
          <Router />
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
