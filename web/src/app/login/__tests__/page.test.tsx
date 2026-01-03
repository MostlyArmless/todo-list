import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import LoginPage from '../page';
import { login, register } from '@/lib/auth';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock the auth module
jest.mock('@/lib/auth', () => ({
  login: jest.fn(),
  register: jest.fn(),
}));

// Helper to get submit button (type="submit")
function getSubmitButton() {
  const buttons = screen.getAllByRole('button');
  const submitButton = buttons.find((btn) => btn.getAttribute('type') === 'submit');
  if (!submitButton) throw new Error('Submit button not found');
  return submitButton;
}

describe('LoginPage', () => {
  const mockPush = jest.fn();
  const mockRouter = { push: mockPush };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
  });

  describe('rendering', () => {
    it('should render the login form by default', () => {
      render(<LoginPage />);

      expect(screen.getByText('Family Todo List')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Email address')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();

      const submitButton = getSubmitButton();
      expect(submitButton).toHaveTextContent('Sign In');
    });

    it('should not show name field in login mode', () => {
      render(<LoginPage />);

      expect(screen.queryByPlaceholderText('Name')).not.toBeInTheDocument();
    });
  });

  describe('mode switching', () => {
    it('should switch to register mode when Register button is clicked', () => {
      render(<LoginPage />);

      const registerTab = screen.getAllByRole('button', { name: /create account/i })[0];
      fireEvent.click(registerTab);

      expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument();

      const submitButton = getSubmitButton();
      expect(submitButton).toHaveTextContent('Create Account');
    });

    it('should switch back to login mode when Login button is clicked', () => {
      render(<LoginPage />);

      // Switch to register
      const registerTab = screen.getAllByRole('button', { name: /create account/i })[0];
      fireEvent.click(registerTab);

      expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument();

      // Switch back to login
      const loginTab = screen.getAllByRole('button', { name: /sign in/i })[0];
      fireEvent.click(loginTab);

      expect(screen.queryByPlaceholderText('Name')).not.toBeInTheDocument();
    });

    it('should show correct submit button text for each mode', () => {
      render(<LoginPage />);

      // Login mode
      expect(getSubmitButton()).toHaveTextContent('Sign In');

      // Switch to register
      const registerTab = screen.getAllByRole('button', { name: /create account/i })[0];
      fireEvent.click(registerTab);

      expect(getSubmitButton()).toHaveTextContent('Create Account');
    });
  });

  describe('form validation', () => {
    it('should have required attributes on email input', () => {
      render(<LoginPage />);

      const emailInput = screen.getByPlaceholderText('Email address');
      expect(emailInput).toHaveAttribute('required');
      expect(emailInput).toHaveAttribute('type', 'email');
    });

    it('should have required attributes on password input', () => {
      render(<LoginPage />);

      const passwordInput = screen.getByPlaceholderText('Password');
      expect(passwordInput).toHaveAttribute('required');
      expect(passwordInput).toHaveAttribute('type', 'password');
      expect(passwordInput).toHaveAttribute('minLength', '8');
    });

    it('should have required attributes on name input in register mode', () => {
      render(<LoginPage />);

      const registerTab = screen.getAllByRole('button', { name: /create account/i })[0];
      fireEvent.click(registerTab);

      const nameInput = screen.getByPlaceholderText('Your name');
      expect(nameInput).toHaveAttribute('required');
    });
  });

  describe('login submission', () => {
    it('should call login with correct credentials', async () => {
      (login as jest.Mock).mockResolvedValue({});

      render(<LoginPage />);

      fireEvent.change(screen.getByPlaceholderText('Email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Password'), {
        target: { value: 'password123' },
      });

      fireEvent.click(getSubmitButton());

      await waitFor(() => {
        expect(login).toHaveBeenCalledWith({ email: 'test@example.com', password: 'password123' });
      });
    });

    it('should redirect to /lists on successful login', async () => {
      (login as jest.Mock).mockResolvedValue({});

      render(<LoginPage />);

      fireEvent.change(screen.getByPlaceholderText('Email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Password'), {
        target: { value: 'password123' },
      });

      fireEvent.click(getSubmitButton());

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/lists');
      });
    });

    it('should display error message on login failure', async () => {
      (login as jest.Mock).mockRejectedValue(new Error('Invalid credentials'));

      render(<LoginPage />);

      fireEvent.change(screen.getByPlaceholderText('Email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Password'), {
        target: { value: 'wrongpassword' },
      });

      fireEvent.click(getSubmitButton());

      await waitFor(() => {
        expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
      });
    });

    it('should show fallback error message when error has no message', async () => {
      (login as jest.Mock).mockRejectedValue({});

      render(<LoginPage />);

      fireEvent.change(screen.getByPlaceholderText('Email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Password'), {
        target: { value: 'password123' },
      });

      fireEvent.click(getSubmitButton());

      await waitFor(() => {
        expect(screen.getByText('Authentication failed')).toBeInTheDocument();
      });
    });
  });

  describe('register submission', () => {
    it('should call register with correct data', async () => {
      (register as jest.Mock).mockResolvedValue({});

      render(<LoginPage />);

      // Switch to register mode
      const registerTab = screen.getAllByRole('button', { name: /create account/i })[0];
      fireEvent.click(registerTab);

      fireEvent.change(screen.getByPlaceholderText('Your name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByPlaceholderText('Email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Password'), {
        target: { value: 'password123' },
      });

      fireEvent.click(getSubmitButton());

      await waitFor(() => {
        expect(register).toHaveBeenCalledWith({ email: 'test@example.com', password: 'password123', name: 'Test User' });
      });
    });

    it('should redirect to /lists on successful registration', async () => {
      (register as jest.Mock).mockResolvedValue({});

      render(<LoginPage />);

      // Switch to register mode
      const registerTab = screen.getAllByRole('button', { name: /create account/i })[0];
      fireEvent.click(registerTab);

      fireEvent.change(screen.getByPlaceholderText('Your name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByPlaceholderText('Email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Password'), {
        target: { value: 'password123' },
      });

      fireEvent.click(getSubmitButton());

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/lists');
      });
    });

    it('should display error message on registration failure', async () => {
      (register as jest.Mock).mockRejectedValue(new Error('Email already exists'));

      render(<LoginPage />);

      // Switch to register mode
      const registerTab = screen.getAllByRole('button', { name: /create account/i })[0];
      fireEvent.click(registerTab);

      fireEvent.change(screen.getByPlaceholderText('Your name'), {
        target: { value: 'Test User' },
      });
      fireEvent.change(screen.getByPlaceholderText('Email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Password'), {
        target: { value: 'password123' },
      });

      fireEvent.click(getSubmitButton());

      await waitFor(() => {
        expect(screen.getByText('Email already exists')).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('should disable submit button while loading', async () => {
      // Create a promise that we can control
      let resolveLogin: (value: unknown) => void;
      const loginPromise = new Promise((resolve) => {
        resolveLogin = resolve;
      });
      (login as jest.Mock).mockReturnValue(loginPromise);

      render(<LoginPage />);

      fireEvent.change(screen.getByPlaceholderText('Email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Password'), {
        target: { value: 'password123' },
      });

      fireEvent.click(getSubmitButton());

      await waitFor(() => {
        expect(getSubmitButton()).toBeDisabled();
        expect(getSubmitButton()).toHaveTextContent('Please wait...');
      });

      // Resolve the promise
      resolveLogin!({});
    });

    it('should show "Please wait..." text while loading', async () => {
      let resolveLogin: (value: unknown) => void;
      const loginPromise = new Promise((resolve) => {
        resolveLogin = resolve;
      });
      (login as jest.Mock).mockReturnValue(loginPromise);

      render(<LoginPage />);

      fireEvent.change(screen.getByPlaceholderText('Email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Password'), {
        target: { value: 'password123' },
      });

      fireEvent.click(getSubmitButton());

      await waitFor(() => {
        expect(screen.getByText('Please wait...')).toBeInTheDocument();
      });

      resolveLogin!({});
    });

    it('should re-enable submit button after error', async () => {
      (login as jest.Mock).mockRejectedValue(new Error('Failed'));

      render(<LoginPage />);

      fireEvent.change(screen.getByPlaceholderText('Email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Password'), {
        target: { value: 'password123' },
      });

      fireEvent.click(getSubmitButton());

      await waitFor(() => {
        expect(screen.getByText('Failed')).toBeInTheDocument();
      });

      // Button should be re-enabled
      expect(getSubmitButton()).not.toBeDisabled();
      expect(getSubmitButton()).toHaveTextContent('Sign In');
    });
  });

  describe('error clearing', () => {
    it('should clear error when form is resubmitted', async () => {
      (login as jest.Mock)
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce({});

      render(<LoginPage />);

      fireEvent.change(screen.getByPlaceholderText('Email address'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('Password'), {
        target: { value: 'password123' },
      });

      // First submission - fails
      fireEvent.click(getSubmitButton());

      await waitFor(() => {
        expect(screen.getByText('First error')).toBeInTheDocument();
      });

      // Second submission - should clear error immediately
      fireEvent.click(getSubmitButton());

      // Error should be cleared before the new request completes
      await waitFor(() => {
        expect(screen.queryByText('First error')).not.toBeInTheDocument();
      });
    });
  });
});
