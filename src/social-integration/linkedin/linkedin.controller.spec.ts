import { Test, TestingModule } from '@nestjs/testing';
import { LinkedinController } from './linkedin.controller';
import { LinkedinService } from './linkedIn.service';

describe('LinkedinController', () => {
  let controller: LinkedinController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LinkedinController],
      providers: [LinkedinService],
    }).compile();

    controller = module.get<LinkedinController>(LinkedinController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
