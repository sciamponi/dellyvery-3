// Inspired by react-hot-toast library
import { useState, useEffect } from "react";

const TOAST_LIMIT = 5;
const TOAST_DISMISS_DELAY = 4000;
const TOAST_REMOVE_DELAY = 5000;

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
};

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Auto-dismiss timers: id -> timeout (DISMISS after TOAST_DISMISS_DELAY)
// Remove timers: id -> timeout (REMOVE after TOAST_REMOVE_DELAY, once dismissed)
const dismissTimeouts = new Map();
const removeTimeouts = new Map();

const clearAutoDismiss = (toastId) => {
  const timeout = dismissTimeouts.get(toastId);
  if (timeout) {
    clearTimeout(timeout);
    dismissTimeouts.delete(toastId);
  }
};

const clearRemoveQueue = (toastId) => {
  const timeout = removeTimeouts.get(toastId);
  if (timeout) {
    clearTimeout(timeout);
    removeTimeouts.delete(toastId);
  }
};

const scheduleAutoDismiss = (toastId, duration = TOAST_DISMISS_DELAY) => {
  if (dismissTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    dismissTimeouts.delete(toastId);
    dispatch({
      type: actionTypes.DISMISS_TOAST,
      toastId,
    });
  }, duration);

  dismissTimeouts.set(toastId, timeout);
};

const addToRemoveQueue = (toastId) => {
  if (removeTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    removeTimeouts.delete(toastId);
    // Auto-dismiss timer is no longer needed once removed
    clearAutoDismiss(toastId);
    dispatch({
      type: actionTypes.REMOVE_TOAST,
      toastId,
    });
  }, TOAST_REMOVE_DELAY);

  removeTimeouts.set(toastId, timeout);
};

export const reducer = (state, action) => {
  switch (action.type) {
    case actionTypes.ADD_TOAST:
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case actionTypes.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };

    case actionTypes.DISMISS_TOAST: {
      const { toastId } = action;

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        clearAutoDismiss(toastId);
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          clearAutoDismiss(toast.id);
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      };
    }
    case actionTypes.REMOVE_TOAST:
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        };
      }
      clearAutoDismiss(action.toastId);
      clearRemoveQueue(action.toastId);
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
    default:
      return state;
  }
};

const listeners = [];

let memoryState = { toasts: [] };

function dispatch(action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

function toast({ duration, ...props }) {
  const id = genId();
  const effectiveDuration =
    typeof duration === "number" && duration >= 0
      ? duration
      : TOAST_DISMISS_DELAY;

  const update = (props) =>
    dispatch({
      type: actionTypes.UPDATE_TOAST,
      toast: { ...props, id },
    });

  const dismiss = () => {
    clearAutoDismiss(id);
    dispatch({ type: actionTypes.DISMISS_TOAST, toastId: id });
  };

  dispatch({
    type: actionTypes.ADD_TOAST,
    toast: {
      ...props,
      id,
      duration: effectiveDuration,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  scheduleAutoDismiss(id, effectiveDuration);

  return {
    id,
    dismiss,
    update,
  };
}

function useToast() {
  const [state, setState] = useState(memoryState);

  useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  return {
    ...state,
    toast,
    dismiss: (toastId) => {
      if (toastId) {
        clearAutoDismiss(toastId);
      } else {
        dismissTimeouts.forEach((timeout) => clearTimeout(timeout));
        dismissTimeouts.clear();
      }
      dispatch({ type: actionTypes.DISMISS_TOAST, toastId });
    },
  };
}

export { useToast, toast };
