import { Controller } from '@nestjs/common';
import { LinkedinService } from './linkedIn.service';

@Controller('linkedin')
export class LinkedinController {
  constructor(private readonly linkedinService: LinkedinService) {}
}
