// Hand-written to match supabase/schema.sql. If you change the schema,
// update this file (or regenerate with `supabase gen types typescript`).

export type EmployeeRole = 'Employee' | 'Technician' | 'Administrator'
export type EmployeeStatus = 'Active' | 'Invited'
export type TicketStatus = 'Open' | 'In progress' | 'Resolved'
export type TicketPriority = 'Critical' | 'High' | 'Medium' | 'Low'

export interface Database {
  public: {
    Tables: {
      employees: {
        Row: {
          id: string
          name: string
          email: string
          department: string
          role: EmployeeRole
          status: EmployeeStatus
          user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          email: string
          department: string
          role: EmployeeRole
          status?: EmployeeStatus
          user_id?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['employees']['Insert']>
        Relationships: []
      }
      tickets: {
        Row: {
          id: string
          title: string
          category: string
          requester_id: string | null
          department: string
          door_number: string
          reported_at: string
          priority: TicketPriority
          status: TicketStatus
          assignee_id: string | null
          description: string
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          category: string
          requester_id?: string | null
          department: string
          door_number?: string
          reported_at?: string
          priority?: TicketPriority
          status?: TicketStatus
          assignee_id?: string | null
          description: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['tickets']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'tickets_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tickets_assignee_id_fkey'
            columns: ['assignee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          }
        ]
      }
      activities: {
        Row: {
          id: string
          user_id: string | null
          action: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          action: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['activities']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'activities_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          }
        ]
      }
      ticket_notes: {
        Row: {
          id: string
          ticket_id: string
          author_id: string | null
          body: string
          created_at: string
        }
        Insert: {
          id?: string
          ticket_id: string
          author_id?: string | null
          body: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['ticket_notes']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'ticket_notes_ticket_id_fkey'
            columns: ['ticket_id']
            isOneToOne: false
            referencedRelation: 'tickets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ticket_notes_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          }
        ]
      }
      articles: {
        Row: {
          id: string
          title: string
          category: string
          body: string
          author_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          category?: string
          body: string
          author_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['articles']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'articles_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          }
        ]
      }
      service_desk_settings: {
        Row: {
          id: boolean
          response_target: string
          escalation_email: string
          updated_at: string
        }
        Insert: {
          id?: boolean
          response_target?: string
          escalation_email?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['service_desk_settings']['Insert']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}