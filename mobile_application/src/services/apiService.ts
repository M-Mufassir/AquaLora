// src/services/apiService.ts
// Centralized HTTP client with error handling, token management, and interceptors

import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../config';
import { AppError } from '../shared/types';

// Custom error type
export class APIError extends Error implements AppError {
  code: string;
  details?: any;

  constructor(code: string, message: string, details?: any) {
    super(message);
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, APIError.prototype);
  }
}

class APIService {
  private axiosInstance: AxiosInstance;
  private refreshTokenPromise: Promise<string | null> | null = null;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: API_BASE_URL,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor: add auth token
    this.axiosInstance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        const token = await SecureStore.getItemAsync('authToken');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error: AxiosError) => {
        return Promise.reject(this.handleError(error));
      }
    );

    // Response interceptor: handle errors and token refresh
    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

        // Handle 401 (token expired) - attempt refresh
        if (error.response?.status === 401 && !originalRequest._retry) {
          if (!this.refreshTokenPromise) {
            this.refreshTokenPromise = this.refreshToken();
          }

          try {
            const newToken = await this.refreshTokenPromise;
            this.refreshTokenPromise = null;

            if (newToken) {
              originalRequest._retry = true;
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              return this.axiosInstance(originalRequest);
            }
          } catch (refreshError) {
            this.refreshTokenPromise = null;
            // Refresh failed, let auth context handle logout
            return Promise.reject(this.handleError(refreshError as AxiosError));
          }
        }

        return Promise.reject(this.handleError(error));
      }
    );
  }

  private async refreshToken(): Promise<string | null> {
    try {
      // TODO: Implement token refresh endpoint if backend supports it
      // For now, return null to trigger logout
      console.warn('Token refresh not yet implemented');
      return null;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return null;
    }
  }

  private handleError(error: any): APIError {
    // Network error
    if (!error.response) {
      if (error.code === 'ECONNABORTED') {
        return new APIError(
          'TIMEOUT',
          'Request timeout. Check your connection.',
          error
        );
      }
      return new APIError(
        'NETWORK_ERROR',
        'Unable to reach the server. Check your internet connection.',
        error
      );
    }

    // Server error
    const status = error.response.status;
    const data = error.response.data;
    const message = data?.message || data?.detail || error.message;

    switch (status) {
      case 400:
        return new APIError('BAD_REQUEST', message || 'Invalid request', data);
      case 401:
        return new APIError('UNAUTHORIZED', 'Your session has expired. Please log in again.', data);
      case 403:
        return new APIError('FORBIDDEN', 'You do not have permission to access this resource.', data);
      case 404:
        return new APIError('NOT_FOUND', 'The requested resource was not found.', data);
      case 500:
        return new APIError('SERVER_ERROR', 'Server error. Please try again later.', data);
      case 503:
        return new APIError('SERVICE_UNAVAILABLE', 'Service temporarily unavailable. Please try again later.', data);
      default:
        return new APIError(
          `HTTP_${status}`,
          message || `Request failed with status ${status}`,
          data
        );
    }
  }

  // Public methods
  async get<T>(url: string, params?: Record<string, any>): Promise<T> {
    const response = await this.axiosInstance.get<T>(url, { params });
    return response.data;
  }

  async post<T>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.axiosInstance.post<T>(url, data, config);
    return response.data;
  }

  async put<T>(url: string, data?: any, config?: any): Promise<T> {
    const response = await this.axiosInstance.put<T>(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: any): Promise<T> {
    const response = await this.axiosInstance.delete<T>(url, config);
    return response.data;
  }

  // Health check
  async health(): Promise<{ status: string }> {
    return this.get('/health');
  }
}

export const apiService = new APIService();
